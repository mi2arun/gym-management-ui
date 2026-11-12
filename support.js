/*
 * Minimal standalone runtime for the .dc.html prototype screens.
 * Supports: {{path}} holes, <sc-for>, <sc-if>, onX="{{fn}}" events,
 * <helmet> head content, and `class Component extends DCLogic` with
 * state / setState / renderVals / componentDidMount / componentWillUnmount.
 */
(function () {
  'use strict';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    if (this.__rerender) this.__rerender();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__rerender) this.__rerender(); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    for (var i = scopes.length - 1; i >= 0; i--) {
      var s = scopes[i];
      if (s != null && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        var v = s[parts[0]];
        for (var j = 1; j < parts.length && v != null; j++) v = v[parts[j]];
        return v;
      }
    }
    return undefined;
  }

  function interp(str, scopes) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null ? '' : String(v); });
  }

  var BOOL_PROPS = { checked: 1, disabled: 1, selected: 1, readonly: 1, required: 1, hidden: 1 };

  function renderNodes(nodes, scopes, out) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scopes, out);
    return out;
  }

  function renderNode(node, scopes, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scopes))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet') return;
    if (tag === 'template' && node.getAttribute('data-sc')) {
      var kind = node.getAttribute('data-sc');
      var kids = node.content.childNodes;
      if (kind === 'if') {
        var cond = valueOf(node.getAttribute('value'), scopes);
        if (cond) renderNodes(kids, scopes, out);
      } else if (kind === 'for') {
        var list = valueOf(node.getAttribute('list'), scopes) || [];
        var as = node.getAttribute('as') || 'item';
        for (var k = 0; k < list.length; k++) {
          var sc = {}; sc[as] = list[k]; sc.$index = k;
          renderNodes(kids, scopes.concat([sc]), out);
        }
      }
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, tag)
      : document.createElement(tag);
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, raw = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = raw.match(WHOLE);
      if (/^on[a-z]+$/i.test(name) && whole) {
        var fn = lookup(whole[1], scopes);
        if (typeof fn === 'function') el.addEventListener(name.slice(2).toLowerCase(), (function (f) { return function (e) { f(e); }; })(fn));
        continue;
      }
      if (whole) {
        var v = lookup(whole[1], scopes);
        if (BOOL_PROPS[name.toLowerCase()]) { if (v && v !== 'false') el.setAttribute(name, ''); continue; }
        if (v === false || v == null) continue;
        el.setAttribute(name, v === true ? '' : String(v));
      } else {
        el.setAttribute(name, interp(raw, scopes));
      }
    }
    if (tag === 'input' && el.hasAttribute('value')) el.value = el.getAttribute('value');
    var target = tag === 'template' ? el.content : el;
    var children = renderNodes(node.childNodes, scopes, []);
    for (var c = 0; c < children.length; c++) target.appendChild(children[c]);
    out.push(el);
  }

  function valueOf(attr, scopes) {
    if (attr == null) return undefined;
    var m = attr.match(WHOLE);
    return m ? lookup(m[1], scopes) : attr;
  }

  function boot(src) {
    var start = src.indexOf('<x-dc>'), end = src.lastIndexOf('</x-dc>');
    if (start < 0 || end < 0) return;
    var markup = src.slice(start + 6, end)
      .replace(/<sc-(for|if)\b/g, '<template data-sc="$1"')
      .replace(/<\/sc-(for|if)>/g, '</template>')
      .replace(/<helmet>/g, '<template data-helmet>')
      .replace(/<\/helmet>/g, '</template>');
    var tpl = document.createElement('template');
    tpl.innerHTML = markup;

    var helmets = tpl.content.querySelectorAll('template[data-helmet]');
    for (var h = 0; h < helmets.length; h++) {
      document.head.appendChild(helmets[h].content.cloneNode(true));
      helmets[h].parentNode.removeChild(helmets[h]);
    }

    var scriptEl = document.querySelector('script[type="text/x-dc"]');
    var props = {};
    var Component = DCLogic;
    if (scriptEl) {
      try { Component = new Function('DCLogic', scriptEl.textContent + '\n;return Component;')(DCLogic); }
      catch (e) { console.error('[dc] component script failed', e); }
    }
    var inst = new Component(props);
    if (!inst.state) inst.state = {};

    var host = document.querySelector('x-dc');
    host.innerHTML = '';
    host.style.display = 'contents';
    host.setAttribute('data-ready', '');

    var pending = false;
    function render() {
      pending = false;
      var scroll = [];
      var all = host.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) if (all[i].scrollTop || all[i].scrollLeft) scroll.push([i, all[i].scrollTop, all[i].scrollLeft]);
      var vals = {};
      try { vals = inst.renderVals ? inst.renderVals() || {} : {}; } catch (e) { console.error('[dc] renderVals failed', e); }
      var nodes = renderNodes(tpl.content.childNodes, [vals], []);
      var frag = document.createDocumentFragment();
      for (var n = 0; n < nodes.length; n++) frag.appendChild(nodes[n]);
      host.innerHTML = '';
      host.appendChild(frag);
      var after = host.querySelectorAll('*');
      for (var s = 0; s < scroll.length; s++) { var t = after[scroll[s][0]]; if (t) { t.scrollTop = scroll[s][1]; t.scrollLeft = scroll[s][2]; } }
    }
    inst.__rerender = function () { if (!pending) { pending = true; requestAnimationFrame(render); } };
    render();

    // Fixed-size phone screens: centre them on a neutral backdrop.
    var root = host.firstElementChild;
    if (root && /^\d+px$/.test(root.style.width || '') && parseInt(root.style.width, 10) <= 480) {
      document.body.style.cssText += ';margin:0;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:24px 0;background:#E9EBEF;';
      root.style.borderRadius = '36px';
      root.style.boxShadow = '0 20px 60px rgba(15,18,23,.25)';
    }
    if (window.top === window.self && !/index\.html$|\/$/.test(location.pathname)) {
      var back = document.createElement('a');
      back.href = 'index.html';
      back.textContent = '\u2190 All screens';
      back.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;height:40px;padding:0 14px;display:flex;align-items:center;border-radius:999px;background:#0F1217;color:#C6F432;font:600 13px Inter,system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.25)';
      document.body.appendChild(back);
    }
    if (inst.componentDidMount) inst.componentDidMount();
    window.addEventListener('pagehide', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
  }

  var hide = document.createElement('style');
  hide.textContent = 'x-dc:not([data-ready]){visibility:hidden}';
  document.head.appendChild(hide);

  function start() {
    fetch(location.href, { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(boot)
      .catch(function (e) { console.error('[dc] boot failed', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
