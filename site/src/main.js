(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var safe = function (fn) { try { return fn(); } catch (e) { return null; } };

  // Remember an explicit language choice; it wins over the system language next time.
  document.querySelectorAll("[data-lang]").forEach(function (a) {
    a.addEventListener("click", function () {
      safe(function () { localStorage.setItem("pp.lang", a.getAttribute("data-lang")); });
    });
  });

  // Entrances: heading, text, picture, staggered, once.
  var revealables = document.querySelectorAll("[data-r]");
  if ("IntersectionObserver" in window && !reduced) {
    root.classList.add("reveal-on");
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); rio.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    revealables.forEach(function (el) { rio.observe(el); });
  }

  // Videos: play only what is on screen, never when reduced motion is requested.
  var videos = Array.prototype.slice.call(document.querySelectorAll("video.shot"));
  function visible(v) { return v.offsetParent !== null; }
  function play(v) {
    if (reduced || !visible(v)) return;
    v.preload = "auto";
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }
  if (reduced) videos.forEach(function (v) { v.controls = true; });

  // Stage: the right half follows whichever section is in the middle of the screen.
  var figs = Array.prototype.slice.call(document.querySelectorAll(".stage figure[data-clip]"));
  var stage = document.querySelector(".stage");
  var current = null;
  function activate(id) {
    if (id === current) return;
    current = id;
    figs.forEach(function (f) {
      var on = f.getAttribute("data-clip") === id;
      f.classList.toggle("on", on);
      var v = f.querySelector("video");
      if (v) { if (on) play(v); else v.pause(); }
    });
  }
  if (figs.length && "IntersectionObserver" in window) {
    var sio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting && stage && stage.offsetParent !== null) activate(e.target.getAttribute("data-stage")); });
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    document.querySelectorAll(".read [data-stage]").forEach(function (s) { sio.observe(s); });
    activate("toggle");
  }

  // Inline clips (phone layout) play while they are mostly in view.
  if ("IntersectionObserver" in window) {
    var vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.target.closest(".inline-clip")) return;
        if (e.isIntersecting) play(e.target); else e.target.pause();
      });
    }, { threshold: 0.5 });
    videos.forEach(function (v) { vio.observe(v); });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) videos.forEach(function (v) { v.pause(); });
    else { var f = figs.filter(function (x) { return x.classList.contains("on"); })[0]; if (f && f.querySelector("video")) play(f.querySelector("video")); }
  });

  // Star count: progressive enhancement, silent on failure.
  var starEl = document.querySelector("[data-star-count]");
  if (starEl) {
    var apply = function (n) {
      starEl.textContent = starEl.getAttribute("data-tpl").replace("{n}", new Intl.NumberFormat(root.lang).format(n));
      starEl.hidden = false;
    };
    var cached = safe(function () { return sessionStorage.getItem("pp.stars"); });
    if (cached) apply(+cached);
    else if (window.fetch) {
      fetch(document.body.getAttribute("data-api") || "https://api.github.com/repos/minsikpaul92/pair-pocket")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && typeof d.stargazers_count === "number") {
            safe(function () { sessionStorage.setItem("pp.stars", d.stargazers_count); });
            apply(d.stargazers_count);
          }
        })
        .catch(function () {});
    }
  }

  // Settlement demo: each friend who pays back lowers your own spending.
  var calc = document.querySelector("[data-calc]");
  if (calc) {
    var total = +calc.getAttribute("data-total"), tpl = calc.getAttribute("data-get"), gotTpl = calc.getAttribute("data-got");
    var buttons = Array.prototype.slice.call(calc.querySelectorAll(".friend"));
    var share = total / (buttons.length + 1);
    var money = function (n) { return "$" + n.toFixed(2); };
    var out = function (k) { return calc.querySelector('[data-out="' + k + '"]'); };
    var draw = function () {
      var got = 0;
      buttons.forEach(function (b) {
        var on = b.getAttribute("aria-pressed") === "true";
        if (on) got += share;
        b.textContent = (on ? gotTpl : tpl).replace("{name}", b.getAttribute("data-name")).replace("{amount}", money(share));
      });
      out("received").textContent = money(got);
      out("mine").textContent = money(total - got);
    };
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
        draw();
      });
    });
    draw();
  }
})();
