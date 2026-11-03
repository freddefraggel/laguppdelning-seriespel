/* Laguppdelning – all data ligger i en JSON-fil på användarens dator.
 *
 * I Chrome och Edge håller appen en levande koppling till filen och sparar
 * automatiskt. Kopplingen minns mellan besök via IndexedDB; webbläsaren kan
 * be om lov igen, och då räcker ett klick.
 * I Safari och Firefox finns inte API:t. Där öppnar man filen manuellt och
 * laddar ner den när man är klar.
 */
(function (root) {
  'use strict';

  var HAS_FS = typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showOpenFilePicker === 'function';

  var DB = 'laguppdelning', STORE = 'handles', KEY = 'current';
  var handle = null;
  var state = { mode: HAS_FS ? 'file' : 'download', name: null, savedAt: null, dirty: false, needsPermission: false, error: null };
  var onStatus = function () {};
  var getData = function () { return {}; };
  var timer = null;

  function emit() { try { onStatus(status()); } catch (e) { /* ignore */ } }

  function status() {
    return {
      supported: HAS_FS,
      mode: state.mode,
      name: state.name,
      savedAt: state.savedAt,
      dirty: state.dirty,
      needsPermission: state.needsPermission,
      error: state.error,
      connected: !!handle
    };
  }

  function idb() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }

  function idbPut(value) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, KEY);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { /* utan IndexedDB får man välja fil varje gång */ });
  }

  function idbGet() {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(KEY);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }

  function serialise() {
    return JSON.stringify(getData(), null, 2) + '\n';
  }

  function writeHandle() {
    return handle.createWritable().then(function (w) {
      return w.write(serialise()).then(function () { return w.close(); });
    }).then(function () {
      state.savedAt = new Date();
      state.dirty = false;
      state.error = null;
      emit();
      return true;
    });
  }

  function ensurePermission(interactive) {
    if (!handle || !handle.queryPermission) return Promise.resolve(true);
    return handle.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return true;
      if (!interactive) return false;
      return handle.requestPermission({ mode: 'readwrite' }).then(function (q) { return q === 'granted'; });
    }).catch(function () { return false; });
  }

  function download() {
    var blob = new Blob([serialise()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = state.name || 'laguppdelning.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    state.savedAt = new Date();
    state.dirty = false;
    emit();
  }

  function pickUpload() {
    return new Promise(function (res) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = function () {
        var f = input.files && input.files[0];
        if (!f) { res(null); return; }
        state.name = f.name;
        f.text().then(function (t) { res(t); });
      };
      input.click();
    });
  }

  var Store = {
    status: status,

    /* opts: { onStatus, getData } */
    init: function (opts) {
      onStatus = opts.onStatus || onStatus;
      getData = opts.getData || getData;
      emit();
    },

    /* Försök återuppta kopplingen från förra besöket. Returnerar texten
       om filen kunde läsas direkt, annars null. */
    resume: function () {
      if (!HAS_FS) return Promise.resolve(null);
      return idbGet().then(function (h) {
        if (!h) return null;
        handle = h;
        state.name = h.name;
        return ensurePermission(false).then(function (ok) {
          if (!ok) { state.needsPermission = true; emit(); return null; }
          state.needsPermission = false;
          emit();
          return handle.getFile().then(function (f) { return f.text(); });
        });
      }).catch(function () { return null; });
    },

    /* Be om lov igen efter en omladdning. Måste ske från ett klick. */
    reconnect: function () {
      if (!handle) return Promise.resolve(null);
      return ensurePermission(true).then(function (ok) {
        if (!ok) return null;
        state.needsPermission = false;
        emit();
        return handle.getFile().then(function (f) { return f.text(); });
      });
    },

    /* Öppna en fil. Returnerar filens text, eller null om användaren avbröt. */
    open: function () {
      if (!HAS_FS) return pickUpload();
      return window.showOpenFilePicker({
        types: [{ description: 'Laguppdelning', accept: { 'application/json': ['.json'] } }],
        multiple: false
      }).then(function (hs) {
        handle = hs[0];
        state.name = handle.name;
        state.needsPermission = false;
        state.error = null;
        return idbPut(handle).then(function () {
          return handle.getFile().then(function (f) { return f.text(); });
        });
      }).then(function (text) {
        state.savedAt = new Date();
        state.dirty = false;
        emit();
        return text;
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return null;
        state.error = e && e.message ? e.message : String(e);
        emit();
        return null;
      });
    },

    saveAs: function (suggested) {
      if (!HAS_FS) { state.name = suggested || state.name; download(); return Promise.resolve(true); }
      return window.showSaveFilePicker({
        suggestedName: suggested || state.name || 'laguppdelning.json',
        types: [{ description: 'Laguppdelning', accept: { 'application/json': ['.json'] } }]
      }).then(function (h) {
        handle = h;
        state.name = h.name;
        state.needsPermission = false;
        return idbPut(handle).then(writeHandle);
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return false;
        state.error = e && e.message ? e.message : String(e);
        emit();
        return false;
      });
    },

    /* Spara nu. Utan koppling blir det en nedladdning. */
    save: function () {
      if (!handle) {
        if (!HAS_FS) { download(); return Promise.resolve(true); }
        return Store.saveAs();
      }
      return ensurePermission(true).then(function (ok) {
        if (!ok) { state.needsPermission = true; emit(); return false; }
        return writeHandle();
      }).catch(function (e) {
        state.error = e && e.message ? e.message : String(e);
        emit();
        return false;
      });
    },

    /* Anropas efter varje ändring. Sparar automatiskt när kopplingen finns. */
    touch: function () {
      state.dirty = true;
      emit();
      if (!handle || state.needsPermission) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        ensurePermission(false).then(function (ok) {
          if (ok) writeHandle().catch(function () { state.needsPermission = true; emit(); });
          else { state.needsPermission = true; emit(); }
        });
      }, 700);
    },

    forget: function () {
      handle = null;
      state.name = null;
      state.savedAt = null;
      state.needsPermission = false;
      idbPut(null);
      emit();
    }
  };

  root.Store = Store;
})(typeof window !== 'undefined' ? window : this);
