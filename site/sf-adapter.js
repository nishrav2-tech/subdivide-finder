// Subdivide Finder adapter: gives the page the same three services it uses on claude.ai,
// backed by your own accounts instead.
//   db      -> Supabase tables sf_runs, sf_deals, sf_outreach, sf_ideas (live updates)
//   mcp     -> Gmail API in the browser (Google sign-in popup, read + send only)
//   sample  -> Supabase Edge Function sf-draft (Claude API)
(function () {
  "use strict";
  var C = window.SF_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var TABLE = { runs: "sf_runs", deals: "sf_deals", outreach: "sf_outreach", ideas: "sf_ideas" };
  var GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

  // ---------------- sign-in gate ----------------
  var readyResolve; var ready = new Promise(function (r) { readyResolve = r; });
  var signedIn = false;
  function gate() { return document.getElementById("sf-gate"); }
  function showGate(msg) {
    var g = gate(); if (!g) return;
    g.hidden = false;
    var m = document.getElementById("sf-gate-msg"); if (m && msg != null) m.textContent = msg;
  }
  function hideGate() { var g = gate(); if (g) g.hidden = true; }
  function onSession(session) {
    if (session && !signedIn) {
      signedIn = true; hideGate();
      var who = document.getElementById("sf-who"); if (who) who.textContent = session.user.email + " · ";
      readyResolve();
    } else if (!session) { showGate(""); }
  }
  sb.auth.getSession().then(function (r) { onSession(r.data.session); });
  sb.auth.onAuthStateChange(function (_e, session) { onSession(session); });

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("sf-gate-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("sf-email").value.trim();
      var pass = document.getElementById("sf-pass").value;
      if (!email) return;
      var m = document.getElementById("sf-gate-msg");
      m.textContent = "Signing in…";
      var p = pass
        ? sb.auth.signInWithPassword({ email: email, password: pass })
        : sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
      p.then(function (r) {
        if (r.error) { m.textContent = r.error.message; return; }
        m.textContent = pass ? "" : "Check your email for a sign-in link.";
      });
    });
    var out = document.getElementById("sf-signout");
    if (out) out.addEventListener("click", function () { sb.auth.signOut().then(function () { location.reload(); }); });
  });

  // ---------------- db shim ----------------
  function errOf(e) { return { code: "invalid_argument", message: (e && e.message) || String(e) }; }
  function splitPath(path) {
    var p = String(path).split("/");
    if (p.length !== 2 || !TABLE[p[0]]) throw new TypeError("Unsupported path: " + path);
    return { t: TABLE[p[0]], id: p[1] };
  }
  function snapOf(rows) {
    var docs = (rows || []).map(function (r) { var d = r.doc || {}; return { id: r.id, exists: true, data: function () { return d; }, metadata: { fromCache: false, hasPendingWrites: false } }; });
    return { docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: function () { return []; } };
  }
  function docRef(path) {
    var x = splitPath(path);
    return {
      id: x.id, path: path,
      get: function () {
        return sb.from(x.t).select("id,doc").eq("id", x.id).maybeSingle().then(function (r) {
          if (r.error) throw errOf(r.error);
          var d = r.data && r.data.doc;
          return { id: x.id, exists: !!r.data, data: function () { return d || undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
        });
      },
      set: function (data) {
        return sb.from(x.t).upsert({ id: x.id, doc: data }).then(function (r) { if (r.error) throw errOf(r.error); kick(x.t); });
      },
      update: function (patch) {
        return sb.from(x.t).select("doc").eq("id", x.id).maybeSingle().then(function (r) {
          if (r.error) throw errOf(r.error);
          if (!r.data) throw { code: "invalid_argument", message: "Document does not exist" };
          var merged = Object.assign({}, r.data.doc || {}, patch);
          return sb.from(x.t).update({ doc: merged }).eq("id", x.id);
        }).then(function (r) { if (r && r.error) throw errOf(r.error); kick(x.t); });
      },
      delete: function () {
        return sb.from(x.t).delete().eq("id", x.id).then(function (r) { if (r.error) throw errOf(r.error); kick(x.t); });
      }
    };
  }
  var listeners = {}; // table -> [refetch]
  function kick(t) { (listeners[t] || []).forEach(function (f) { f(); }); }
  function collection(name) {
    var t = TABLE[name];
    if (!t) throw new TypeError("Unsupported collection: " + name);
    return {
      path: name,
      doc: function (id) { return docRef(name + "/" + (id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())))); },
      add: function (data) {
        var ref = this.doc();
        return ref.set(data).then(function () { return ref; });
      },
      onSnapshot: function (next, error) {
        var alive = true, timer = null;
        function refetch() {
          clearTimeout(timer);
          timer = setTimeout(function () {
            sb.from(t).select("id,doc").limit(5000).then(function (r) {
              if (!alive) return;
              if (r.error) { if (error) error(errOf(r.error)); return; }
              next(snapOf(r.data));
            });
          }, 150);
        }
        (listeners[t] = listeners[t] || []).push(refetch);
        refetch();
        var ch = sb.channel("sf-" + t + "-" + Math.random().toString(36).slice(2))
          .on("postgres_changes", { event: "*", schema: "public", table: t }, refetch)
          .subscribe();
        var poll = setInterval(refetch, 60000);
        return function () { alive = false; clearInterval(poll); sb.removeChannel(ch); listeners[t] = (listeners[t] || []).filter(function (f) { return f !== refetch; }); };
      }
    };
  }
  var db = { doc: docRef, collection: collection };

  // ---------------- Gmail (browser) ----------------
  var token = null, tokenExp = 0, tokenClient = null;
  try { var saved = JSON.parse(sessionStorage.getItem("sf_gmail") || "null"); if (saved && saved.exp > Date.now()) { token = saved.token; tokenExp = saved.exp; } } catch (e) {}
  function connectGmail() {
    return new Promise(function (resolve, reject) {
      if (!window.google || !google.accounts || !google.accounts.oauth2) { reject({ code: "server_not_connected", message: "Google sign-in didn't load. Reload the page." }); return; }
      if (!C.GOOGLE_CLIENT_ID || /PASTE/.test(C.GOOGLE_CLIENT_ID)) { reject({ code: "server_not_connected", message: "Add your Google client ID to config.js." }); return; }
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({ client_id: C.GOOGLE_CLIENT_ID, scope: GMAIL_SCOPES, hint: C.GMAIL_ACCOUNT, callback: function () {} });
      tokenClient.callback = function (r) {
        if (r.error) { reject({ code: "needs_reauth", message: r.error }); return; }
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
        try { sessionStorage.setItem("sf_gmail", JSON.stringify({ token: token, exp: tokenExp })); } catch (e) {}
        resolve();
      };
      tokenClient.requestAccessToken({ prompt: "" });
    });
  }
  function g(path, opts) {
    if (!token || Date.now() > tokenExp) return Promise.reject({ code: "needs_reauth", message: "Connect Gmail" });
    opts = opts || {};
    var headers = { Authorization: "Bearer " + token };
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { method: opts.method || "GET", headers: headers, body: opts.body }).then(function (r) {
      if (r.status === 401) { token = null; try { sessionStorage.removeItem("sf_gmail"); } catch (e) {} throw { code: "needs_reauth", message: "Gmail sign-in expired" }; }
      if (r.status === 403 || r.status === 429 || r.status >= 500) return r.text().then(function (t) { throw { code: r.status >= 500 ? "server_unavailable" : "tool_error", message: t.slice(0, 200), retryable: r.status >= 500 }; });
      if (!r.ok) return r.text().then(function (t) { throw { code: "tool_error", message: t.slice(0, 200) }; });
      return r.json();
    });
  }
  function b64urlDecode(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function hdr(m, name) {
    var hs = (m.payload && m.payload.headers) || [];
    for (var i = 0; i < hs.length; i++) if (hs[i].name.toLowerCase() === name.toLowerCase()) return hs[i].value;
    return "";
  }
  function findPart(p, mime) {
    if (!p) return "";
    if (p.mimeType === mime && p.body && p.body.data) return b64urlDecode(p.body.data);
    var parts = p.parts || [];
    for (var i = 0; i < parts.length; i++) { var t = findPart(parts[i], mime); if (t) return t; }
    return "";
  }
  function stripHtml(h) {
    var d = new DOMParser().parseFromString(String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n"), "text/html");
    return (d.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }
  function attachments(p, out) {
    out = out || [];
    if (!p) return out;
    if (p.filename) out.push({ filename: p.filename });
    (p.parts || []).forEach(function (x) { attachments(x, out); });
    return out;
  }
  function splitAddrs(s) { return String(s || "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function getThread(threadId) {
    return g("threads/" + encodeURIComponent(threadId) + "?format=full").then(function (t) {
      return {
        id: t.id,
        viewUrl: "https://mail.google.com/mail/?authuser=" + encodeURIComponent(C.GMAIL_ACCOUNT) + "#all/" + t.id,
        messages: (t.messages || []).map(function (m) {
          var text = findPart(m.payload, "text/plain") || stripHtml(findPart(m.payload, "text/html"));
          return {
            id: m.id, sender: hdr(m, "From"), toRecipients: splitAddrs(hdr(m, "To")), subject: hdr(m, "Subject"),
            date: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet || "", plaintextBody: text,
            attachments: attachments(m.payload), messageId: hdr(m, "Message-ID"), references: hdr(m, "References")
          };
        })
      };
    });
  }
  function searchThreads(query, max) {
    return g("threads?maxResults=" + (max || 50) + "&q=" + encodeURIComponent(query)).then(function (r) {
      var list = r.threads || [];
      return Promise.all(list.map(function (t) {
        return g("threads/" + t.id + "?format=metadata&metadataHeaders=From").then(function (full) {
          var first = (full.messages || [])[0];
          return { id: t.id, messages: first ? [{ id: first.id, sender: hdr(first, "From") }] : [] };
        }).catch(function () { return { id: t.id, messages: [] }; });
      })).then(function (threads) { return { threads: threads }; });
    });
  }
  function encHeader(s) { return /[^\x20-\x7e]/.test(s) ? "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(s))) + "?=" : s; }
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function sendMessage(input) {
    var to = (input.to || []).join(", "), cc = (input.cc || []).join(", ");
    var sig = input.includeSignature && C.SIGNATURE_TEXT ? C.SIGNATURE_TEXT : "";
    var text = String(input.body || "") + (sig ? "\n\n--\n" + sig : "");
    var html = "<div style=\"font-family:Arial,sans-serif;font-size:14px\">" + escHtml(input.body || "").replace(/\n/g, "<br>") +
      (sig ? "<br><br>--<br>" + escHtml(sig).replace(/\n/g, "<br>") : "") + "</div>";
    var pre = input.replyThreadId ? getThread(input.replyThreadId).catch(function () { return null; }) : Promise.resolve(null);
    return pre.then(function (th) {
      var last = th && th.messages.length ? th.messages[th.messages.length - 1] : null;
      var boundary = "sf_" + Math.random().toString(36).slice(2);
      var lines = [
        "From: " + C.GMAIL_ACCOUNT,
        "To: " + to,
        cc ? "Cc: " + cc : null,
        "Subject: " + encHeader(input.subject || ""),
        last && last.messageId ? "In-Reply-To: " + last.messageId : null,
        last && last.messageId ? "References: " + ((last.references ? last.references + " " : "") + last.messageId) : null,
        "MIME-Version: 1.0",
        "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"",
        "",
        "--" + boundary,
        "Content-Type: text/plain; charset=\"UTF-8\"",
        "",
        text,
        "--" + boundary,
        "Content-Type: text/html; charset=\"UTF-8\"",
        "",
        html,
        "--" + boundary + "--"
      ].filter(function (x) { return x !== null; }).join("\r\n");
      var body = { raw: b64urlEncode(lines) };
      if (input.replyThreadId) body.threadId = input.replyThreadId;
      return g("messages/send", { method: "POST", body: JSON.stringify(body) });
    }).then(function (r) { return { id: r.id, threadId: r.threadId }; });
  }
  function run(tool, input) {
    if (tool === "get_thread") return getThread(input.threadId);
    if (tool === "search_threads") return searchThreads(input.query, input.pageSize);
    if (tool === "send_message") return sendMessage(input);
    return Promise.reject({ code: "bad_request", message: "Unknown tool " + tool });
  }
  var watchers = [];
  var mcp = {
    watchTool: function (server, tool, input, handler, opts) {
      var alive = true;
      function go() {
        run(tool, input).then(function (p) { if (alive) handler({ type: "data", result: { payload: p } }); })
          .catch(function (e) { if (alive) handler({ type: "error", error: e && e.code ? e : { code: "upstream_error", message: String(e) } }); });
      }
      var w = { go: go };
      watchers.push(w);
      setTimeout(go, 0);
      var iv = setInterval(function () { if (!document.hidden) go(); }, Math.max(30000, (opts && opts.refetchInterval) || 300000));
      return function () { alive = false; clearInterval(iv); watchers = watchers.filter(function (x) { return x !== w; }); };
    },
    callTool: function (server, tool, input) {
      return run(tool, input).then(function (p) { return { content: [], payload: p }; });
    },
    invalidate: function () { watchers.forEach(function (w) { w.go(); }); return Promise.resolve(); }
  };

  // ---------------- Claude drafting via Edge Function ----------------
  function sample(input, opts) {
    var prompt = typeof input === "string" ? input : (input || []).map(function (m) { return m.content; }).join("\n\n");
    return sb.functions.invoke(C.DRAFT_FUNCTION || "sf-draft", { body: { prompt: prompt } }).then(function (r) {
      if (r.error) {
        var status = r.error.context && r.error.context.status;
        throw { code: status === 401 || status === 403 ? "not_granted" : "upstream_error", message: r.error.message };
      }
      var text = (r.data && r.data.text) || "";
      if (!text) throw { code: "empty_completion", message: "No text" };
      if (opts && typeof opts.onText === "function") { try { opts.onText({ text: text, delta: text }); } catch (e) {} }
      return { text: text, truncated: !!(r.data && r.data.truncated) };
    });
  }
  sample.json = function (input, opts) {
    return sample(input, opts).then(function (r) {
      var t = r.text.trim();
      var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) t = fence[1];
      var a = t.indexOf("{"), b = t.lastIndexOf("}");
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
      try { return JSON.parse(t); } catch (e) { throw { code: "invalid_json", message: "Bad JSON", text: r.text }; }
    });
  };

  window.SF = { sb: sb, connectGmail: function () { return connectGmail().then(function () { return mcp.invalidate(); }); } };
  window.claude = {
    use: function (name) {
      return ready.then(function () {
        if (name === "db") return db;
        if (name === "mcp") return mcp;
        if (name === "sample") return sample;
        return null;
      });
    }
  };
})();
