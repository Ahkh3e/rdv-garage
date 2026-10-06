// Shared by the link pages. config.js (written by build.mjs) defines window.RDV.
(function () {
  const cfg = window.RDV || {};
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  window.RDVLinks = {
    cfg, isIOS, isAndroid,
    lastSegment() {
      const parts = location.pathname.split("/").filter(Boolean);
      return decodeURIComponent(parts[parts.length - 1] || "").toUpperCase();
    },
    async rpc(schema, name, args) {
      const res = await fetch(cfg.supabaseUrl + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey, Authorization: "Bearer " + cfg.supabaseKey, "Content-Profile": schema },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error("request failed");
      return res.json();
    },
    show(id) { document.getElementById(id)?.classList.remove("hidden"); },
    hide(id) { document.getElementById(id)?.classList.add("hidden"); },
    storeUrl(code) {
      if (isIOS) return cfg.appStoreUrl;
      if (isAndroid) return cfg.playUrl + (code ? (cfg.playUrl.includes("?") ? "&" : "?") + "referrer=" + encodeURIComponent("invite=" + code) : "");
      return null;
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    },
  };
})();
