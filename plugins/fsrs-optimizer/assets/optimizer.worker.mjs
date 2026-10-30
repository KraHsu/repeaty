//#region \0rolldown/runtime.js
var e = Object.defineProperty, t = (t, n) => {
	let r = {};
	for (var i in t) e(r, i, {
		get: t[i],
		enumerable: !0
	});
	return n || e(r, Symbol.toStringTag, { value: "Module" }), r;
}, n = /* @__PURE__ */ ((e) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(e, { get: (e, t) => (typeof require < "u" ? require : e)[t] }) : e)(function(e) {
	if (typeof require < "u") return require.apply(this, arguments);
	throw Error("Calling `require` for \"" + e + "\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.");
}), r = typeof WebAssembly < "u" ? WebAssembly : typeof WXWebAssembly < "u" ? WXWebAssembly : void 0, i = typeof process == "object" && process !== null && typeof process.versions == "object" && process.versions !== null && typeof process.versions.node == "string";
function a(e) {
	return typeof e?.postMessage == "function" ? e.postMessage : typeof postMessage == "function" ? postMessage : void 0;
}
function o(e) {
	if (e instanceof Error) return e;
	if (typeof e == "object" && e && "error" in e) {
		let t = e.error;
		if (t !== void 0 && t !== e) return o(t);
	}
	let t = typeof e == "object" && e ? e : void 0, n = t?.message === void 0 ? typeof e == "string" ? e : "Worker sent an unknown error" : String(t.message), i = t?.name === void 0 ? "Error" : String(t.name), a;
	try {
		a = new (i === "RuntimeError" ? r?.RuntimeError ?? Error : Error)(n);
	} catch {
		a = Error(n);
	}
	return a.name = i, t?.stack !== void 0 && Object.defineProperty(a, "stack", {
		value: String(t.stack),
		writable: !0,
		enumerable: !1,
		configurable: !0
	}), t?.cause !== void 0 && Object.defineProperty(a, "cause", {
		value: t.cause,
		writable: !0,
		enumerable: !1,
		configurable: !0
	}), a;
}
function s(e) {
	let t = o(e), n = {
		name: t.name,
		message: t.message
	};
	return t.stack !== void 0 && (n.stack = t.stack), "cause" in t && t.cause !== void 0 && (n.cause = t.cause), n;
}
function c(e) {
	return o(e);
}
function l(e, t, n) {
	let r = new Int32Array(e);
	if (Atomics.store(r, 0, t), t > 1 && n) {
		let t = n.name, i = n.message, a = n.stack ?? "", o = new TextEncoder().encode(t), s = new TextEncoder().encode(i), c = new TextEncoder().encode(a);
		Atomics.store(r, 1, o.length), Atomics.store(r, 2, s.length), Atomics.store(r, 3, c.length);
		let l = new Uint8Array(e);
		l.set(o, 16), l.set(s, 16 + o.length), l.set(c, 16 + o.length + s.length);
	}
}
function u(e) {
	let t = new Int32Array(e);
	if (Atomics.load(t, 0) <= 1) return null;
	let n = Atomics.load(t, 1), i = Atomics.load(t, 2), a = Atomics.load(t, 3), o = new Uint8Array(e), s = o.slice(16, 16 + n), c = o.slice(16 + n, 16 + n + i), l = o.slice(16 + n + i, 16 + n + i + a), u = new TextDecoder().decode(s), d = new TextDecoder().decode(c), f = new TextDecoder().decode(l), p = new (globalThis[u] ?? (u === "RuntimeError" ? r.RuntimeError ?? Error : Error))(d);
	return Object.defineProperty(p, "stack", {
		value: f,
		writable: !0,
		enumerable: !1,
		configurable: !0
	}), p;
}
var d = u;
function f(e) {
	return typeof SharedArrayBuffer == "function" && e instanceof SharedArrayBuffer || Object.prototype.toString.call(e) === "[object SharedArrayBuffer]";
}
function p(e) {
	try {
		return e instanceof r.RuntimeError || e?.name === "RuntimeError";
	} catch {
		return e?.name === "RuntimeError";
	}
}
function m(e, t) {
	return { __emnapi__: {
		type: e,
		payload: t
	} };
}
function h(e) {
	if (e) {
		if (!f(e.buffer)) throw Error("Multithread features require shared wasm memory. Try to compile with `-matomics -mbulk-memory` and use `--import-memory --shared-memory` during linking, then create WebAssembly.Memory with `shared: true` option");
	} else if (typeof SharedArrayBuffer > "u") throw Error("Current environment does not support SharedArrayBuffer, threads are not available!");
}
function g(e) {
	if (typeof e == "boolean") return e ? {
		size: 0,
		strict: !1
	} : !1;
	if (typeof e == "number") {
		if (!(e >= 0)) throw RangeError("reuseWorker: size must be a non-negative integer");
		return {
			size: e,
			strict: !1
		};
	}
	if (!e) return !1;
	let t = Number(e.size) || 0, n = !!e.strict;
	if (!(t > 0) && n) throw RangeError("reuseWorker: size must be set to positive integer if strict is set to true");
	return {
		size: t,
		strict: n
	};
}
var _ = 0, v = class {
	get nextWorkerID() {
		return _;
	}
	constructor(e) {
		if (this.unusedWorkers = [], this.pthreads = Object.create(null), this.wasmModule = null, this.wasmMemory = null, this.messageEvents = /* @__PURE__ */ new WeakMap(), this.registeredWorkers = /* @__PURE__ */ new Set(), this.expectedTerminations = /* @__PURE__ */ new WeakSet(), this.loadRejects = /* @__PURE__ */ new WeakMap(), !e) throw TypeError("ThreadManager(): options is not provided");
		this._childThread = "childThread" in e && !!e.childThread, this._childThread ? (this._onCreateWorker = void 0, this._reuseWorker = !1, this._beforeLoad = void 0) : (this._onCreateWorker = e.onCreateWorker, this._reuseWorker = g(e.reuseWorker), this._beforeLoad = e.beforeLoad), this.printErr = e.printErr ?? console.error.bind(console), this.threadSpawn = e.threadSpawn;
	}
	init() {
		this._childThread || this.initMainThread();
	}
	initMainThread() {
		this.preparePool();
	}
	preparePool() {
		if (this._reuseWorker && this._reuseWorker.size) {
			let e = this._reuseWorker.size;
			for (; e--;) this.allocatePoolWorker();
		}
	}
	shouldPreloadWorkers() {
		return !this._childThread && this._reuseWorker && this._reuseWorker.size > 0;
	}
	loadWasmModuleToAllWorkers() {
		let e = Array(this.unusedWorkers.length);
		for (let t = 0; t < this.unusedWorkers.length; ++t) {
			let n = this.unusedWorkers[t];
			i && n.ref(), e[t] = this.loadWasmModuleToWorker(n).then((e) => (i && n.unref(), e), (e) => {
				throw i && n.unref(), e;
			});
		}
		return Promise.all(e).catch((e) => {
			throw this.terminateAllThreads(), e;
		});
	}
	preloadWorkers() {
		return this.shouldPreloadWorkers() ? this.loadWasmModuleToAllWorkers() : Promise.resolve([]);
	}
	setup(e, t) {
		this.wasmModule = e, this.wasmMemory = t;
	}
	assertRunning() {
		if (this._fatalError) throw this._fatalError;
	}
	fail(e, t) {
		if (!this._fatalError && (this._fatalError = o(e), this.shutdownAllWorkers(!1, this._fatalError), t)) {
			let e = this._fatalError;
			Promise.resolve().then(() => {
				throw e;
			});
		}
	}
	markId(e) {
		if (this.assertRunning(), e.__emnapi_tid) return e.__emnapi_tid;
		let t = _ + 43;
		return _ = (_ + 1) % 536870869, this.pthreads[t] = e, e.__emnapi_tid = t, t;
	}
	returnWorkerToPool(e) {
		if (this._fatalError) this.terminateWorker(e);
		else {
			var t = e.__emnapi_tid;
			t !== void 0 && delete this.pthreads[t], this.unusedWorkers.push(e), delete e.__emnapi_tid, i && e.unref();
		}
	}
	loadWasmModuleToWorker(e, t) {
		if (this.assertRunning(), e.whenLoaded) return e.whenLoaded;
		this.registeredWorkers.add(e);
		let n = this.printErr, r = this._beforeLoad, a = this;
		return e.whenLoaded = new Promise((s, l) => {
			let u = function(t) {
				if (a.expectedTerminations.has(e)) return;
				let r = "worker sent an error!";
				e.__emnapi_tid !== void 0 && (r = "worker (tid = " + e.__emnapi_tid + ") sent an error!");
				let s = o(t);
				if (s.message ? n(r + " " + s.message) : n(r), !e.loaded) l(s), a.dropFailedLoad(e);
				else if (a.fail(s, !i), i) throw s;
			}, d = (t) => {
				if (t.__emnapi__) {
					let n = t.__emnapi__.type, r = t.__emnapi__.payload;
					if (n === "loaded") e.loaded = !0, this.loadRejects.delete(e), i && !e.__emnapi_tid && e.unref(), s(e);
					else if (n === "cleanup-thread") r.tid in this.pthreads && this.cleanThread(e, r.tid);
					else if (n === "spawn-thread") this.threadSpawn(r.startArg, r.errorOrTid);
					else if (n === "terminate-all-threads") this.terminateAllThreads();
					else if (n === "thread-error") {
						let t = r, n = c(t.error);
						!e.loaded && t.phase === "load" ? (l(n), this.dropFailedLoad(e)) : this.fail(n, !0);
					}
				}
			};
			e.onmessage = (t) => {
				d(t.data), this.fireMessageEvent(e, t);
			}, e.onerror = u, e.onmessageerror = (e) => {
				u(o(e));
			}, i && (e.on("message", function(t) {
				e.onmessage?.({ data: t });
			}), e.on("error", function(t) {
				e.onerror?.(t);
			}), e.on("messageerror", function(e) {
				u(o(e));
			}), e.on("exit", function(t) {
				a.expectedTerminations.has(e) || u(/* @__PURE__ */ Error("Worker stopped with exit code " + t));
			}), e.on("detachedExit", function() {})), this.loadRejects.set(e, l);
			try {
				typeof r == "function" && r(e), e.postMessage(m("load", {
					wasmModule: this.wasmModule,
					wasmMemory: this.wasmMemory,
					sab: t
				}));
			} catch (t) {
				let n = t;
				try {
					h(this.wasmMemory);
				} catch (e) {
					n = e;
				}
				l(n), this.dropFailedLoad(e);
			}
		}), e.whenLoaded;
	}
	allocateUnusedWorker() {
		this.assertRunning();
		let e = this._onCreateWorker;
		if (typeof e != "function") throw TypeError("`options.onCreateWorker` is not provided");
		let t = e({
			type: "thread",
			name: "emnapi-pthread"
		});
		return this.registeredWorkers.add(t), this.unusedWorkers.push(t), t;
	}
	allocatePoolWorker() {
		let e = this.allocateUnusedWorker();
		return i && (e.once("message", () => {}), e.unref()), e;
	}
	dropFailedLoad(e) {
		let t = this.unusedWorkers.indexOf(e) !== -1;
		this.loadRejects.delete(e), this.terminateWorker(e), t && !this._fatalError && this.allocatePoolWorker();
	}
	getNewWorker(e) {
		if (this.assertRunning(), this._reuseWorker) {
			if (this.unusedWorkers.length === 0) {
				if (this._reuseWorker.strict && !i) {
					let e = this.printErr;
					e("Tried to spawn a new thread, but the thread pool is exhausted.\nThis might result in a deadlock unless some threads eventually exit or the code explicitly breaks out to the event loop.");
					return;
				}
				return this.allocateAndLoadWorker(e);
			}
			let t = this.unusedWorkers.pop();
			return t.whenLoaded || this.loadWasmModuleToWorker(t, e), t;
		}
		return this.allocateAndLoadWorker(e);
	}
	allocateAndLoadWorker(e) {
		let t = this.allocateUnusedWorker();
		return this.unusedWorkers.pop(), this.loadWasmModuleToWorker(t, e), this.expectedTerminations.has(t) ? void 0 : t;
	}
	cleanThread(e, t, n) {
		!n && this._reuseWorker ? this.returnWorkerToPool(e) : (delete this.pthreads[t], this.terminateWorker(e), delete e.__emnapi_tid);
	}
	terminateWorker(e) {
		let t = e.__emnapi_tid;
		this.expectedTerminations.add(e), this.registeredWorkers.delete(e);
		let n = this.unusedWorkers.indexOf(e);
		n !== -1 && this.unusedWorkers.splice(n, 1), this.loadRejects.delete(e), e.terminate(), this.messageEvents.get(e)?.clear(), this.messageEvents.delete(e), e.onmessage = (e) => {
			if (e.data.__emnapi__) {
				let n = e.data.__emnapi__.type;
				if (n === "loaded") return;
				let r = this.printErr;
				r("received \"" + n + "\" command from terminated worker: " + t);
			}
		};
	}
	terminateAllThreads() {
		this.shutdownAllWorkers(!0);
	}
	shutdownAllWorkers(e, t) {
		(/* @__PURE__ */ new Set([
			...this.registeredWorkers,
			...Object.values(this.pthreads),
			...this.unusedWorkers
		])).forEach((e) => {
			t && this.loadRejects.get(e)?.(t), this.terminateWorker(e);
		}), this.unusedWorkers = [], this.pthreads = Object.create(null), e && !this._fatalError && this.preparePool();
	}
	addMessageEventListener(e, t) {
		let n = this.messageEvents.get(e);
		return n || (n = /* @__PURE__ */ new Set(), this.messageEvents.set(e, n)), n.add(t), () => {
			n?.delete(t);
		};
	}
	fireMessageEvent(e, t) {
		let n = this.messageEvents.get(e);
		if (!n) return;
		let r = this.printErr;
		n.forEach((e) => {
			try {
				e(t);
			} catch (e) {
				r(e.stack);
			}
		});
	}
}, y = Symbol("kIsProxy");
function b(e, t) {
	if (e[y]) return e;
	let n = e.exports, r = function(e) {
		let t = [
			"apply",
			"construct",
			"defineProperty",
			"deleteProperty",
			"get",
			"getOwnPropertyDescriptor",
			"getPrototypeOf",
			"has",
			"isExtensible",
			"ownKeys",
			"preventExtensions",
			"set",
			"setPrototypeOf"
		], n = {};
		for (let r = 0; r < t.length; r++) {
			let i = t[r];
			n[i] = function() {
				let t = Array.prototype.slice.call(arguments, 1);
				return t.unshift(e), Reflect[i].apply(Reflect, t);
			};
		}
		return n;
	}(n), i = () => {}, a = () => 0;
	r.get = function(e, r, o) {
		return r === "memory" ? (typeof t == "function" ? t() : t) ?? Reflect.get(n, r, o) : r === "_initialize" ? r in n ? i : void 0 : r === "_start" ? r in n ? a : void 0 : Reflect.get(n, r, o);
	}, r.has = function(e, t) {
		return t === "memory" || Reflect.has(n, t);
	};
	let o = new Proxy(Object.create(null), r);
	return new Proxy(e, { get(e, t, n) {
		return t === "exports" ? o : t === y || Reflect.get(e, t, n);
	} });
}
var x = /* @__PURE__ */ new WeakMap(), S = Int32Array.BYTES_PER_ELEMENT * 2, C = typeof SharedArrayBuffer == "function" ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength").get : void 0;
function w(e) {
	if (C === void 0) return !1;
	try {
		return C.call(e), !0;
	} catch {
		return !1;
	}
}
function T(e, t, n) {
	let r = typeof t == "bigint" ? Number(t) : t >>> 0, i = e.buffer;
	return r + S > i.byteLength && w(i) && (n ? e.grow(BigInt(0)) : e.grow(0), i = e.buffer), new Int32Array(i, r, 2);
}
var E = class {
	constructor(e) {
		if (!e) throw TypeError("WASIThreads(): options is not provided");
		if (!e.wasi) throw TypeError("WASIThreads(): options.wasi is not provided");
		x.set(this, /* @__PURE__ */ new WeakSet());
		let t = e.wasi;
		ee(this, t), this.wasi = t, this.childThread = "childThread" in e && !!e.childThread, this.PThread = void 0, "threadManager" in e ? this.PThread = typeof e.threadManager == "function" ? e.threadManager() : e.threadManager : this.childThread || (this.PThread = new v(e), this.PThread.init());
		let n = !1;
		"waitThreadStart" in e && (n = typeof e.waitThreadStart == "number" ? e.waitThreadStart : !!e.waitThreadStart);
		let r = a(e);
		if (this.childThread && typeof r != "function") throw TypeError("options.postMessage is not a function");
		this.postMessage = r;
		let o = !!e.wasm64, s = (e, t) => {
			let a = t !== void 0;
			try {
				h(this.wasmMemory);
			} catch (e) {
				if (this.PThread?.printErr(e.stack), a) {
					let e = T(this.wasmMemory, t, o);
					return Atomics.store(e, 0, 1), Atomics.store(e, 1, 6), Atomics.notify(e, 1), 1;
				}
				return -6;
			}
			if (!a) {
				let e = this.wasmInstance.exports.malloc;
				if (t = o ? Number(e(BigInt(8))) : e(8) >>> 0, !t) return -48;
			}
			let s = this.wasmInstance.exports.free, c = o ? (e) => {
				s(BigInt(e));
			} : s, l = T(this.wasmMemory, t, o);
			if (Atomics.store(l, 0, 0), Atomics.store(l, 1, 0), this.childThread) {
				r(m("spawn-thread", {
					startArg: e,
					errorOrTid: t
				})), Atomics.wait(l, 1, 0);
				let n = Atomics.load(l, 0), i = Atomics.load(l, 1);
				return a ? n : (c(t), n ? -i : i);
			}
			let u = n || n === 0, f;
			u && (f = new Int32Array(new SharedArrayBuffer(8208)), Atomics.store(f, 0, 0));
			let p, g, _ = this.PThread;
			try {
				if (p = _.getNewWorker(f), !p) throw Error("failed to get new worker");
				if (g = _.markId(p), i && p.unref(), p.postMessage(m("start", {
					tid: g,
					arg: e,
					sab: f
				})), u) {
					if (typeof n == "number") {
						if (Atomics.wait(f, 0, 0, n) === "timed-out") throw Error("Spawning thread timed out. Please check if the worker is created successfully and if message is handled properly in the worker.");
					} else Atomics.wait(f, 0, 0);
					if (Atomics.load(f, 0) > 1) throw d(f.buffer);
				}
			} catch (e) {
				if (p !== void 0 && g !== void 0) try {
					_.cleanThread(p, g, !0);
				} catch {}
				return Atomics.store(l, 0, 1), Atomics.store(l, 1, 6), Atomics.notify(l, 1), _?.printErr(e.stack), a ? 1 : (c(t), -6);
			}
			return Atomics.store(l, 0, 0), Atomics.store(l, 1, g), Atomics.notify(l, 1), u || p.whenLoaded.catch((e) => {
				delete p.whenLoaded, _.cleanThread(p, g, !0), _.printErr("failed to load the worker of thread " + g + ": " + (e && e.stack || e));
			}), a ? 0 : (c(t), g);
		};
		this.threadSpawn = s, this.PThread && (this.PThread.threadSpawn = s);
	}
	getImportObject() {
		return { wasi: { "thread-spawn": this.threadSpawn } };
	}
	setup(e, t, n) {
		n ??= e.exports.memory, this.wasmInstance = e, this.wasmMemory = n, this.PThread && this.PThread.setup(t, n);
	}
	preloadWorkers() {
		return this.PThread ? this.PThread.preloadWorkers() : Promise.resolve([]);
	}
	initialize(e, t, n) {
		let r = e.exports;
		n ??= r.memory, this.childThread && (e = b(e, n)), this.setup(e, t, n);
		let i = this.wasi;
		if ("_start" in r && typeof r._start == "function") {
			if (this.childThread) {
				i.start(e);
				try {
					let e = D(i, "kStarted");
					i[e] = !1;
				} catch {}
			} else O(i, e);
		} else i.initialize(e);
		return e;
	}
	start(e, t, n) {
		let r = e.exports;
		return n ??= r.memory, this.childThread && (e = b(e, n)), this.setup(e, t, n), {
			exitCode: this.wasi.start(e),
			instance: e
		};
	}
	terminateAllThreads() {
		this.childThread ? this.postMessage(m("terminate-all-threads", {})) : this.PThread?.terminateAllThreads();
	}
};
function ee(e, t) {
	let n = x.get(e);
	if (n.has(t)) return;
	let r = e, i = t.wasiImport;
	if (i) {
		let e = i.proc_exit;
		i.proc_exit = function(t) {
			return r.terminateAllThreads(), e.call(this, t);
		};
	}
	if (!r.childThread) {
		let e = t.start;
		typeof e == "function" && (t.start = function(t) {
			try {
				return e.call(this, t);
			} catch (e) {
				throw p(e) && r.terminateAllThreads(), e;
			}
		});
	}
	n.add(t);
}
function D(e, t) {
	let n = Object.getOwnPropertySymbols(e), r = (e) => (t) => t.description ? t.description === e : t.toString() === `Symbol(${e})`;
	return Array.isArray(t) ? t.map((e) => n.filter(r(e))[0]) : n.filter(r(t))[0];
}
function O(e, t) {
	let [n, r] = D(e, ["kInstance", "kSetMemory"]);
	e[n] = t, e[r](t.exports.memory);
}
var te = class {
	constructor(e) {
		let t = a(e);
		if (typeof t != "function") throw TypeError("options.postMessage is not a function");
		this.postMessage = t, this.onLoad = e?.onLoad, this.onError = typeof e?.onError == "function" ? e.onError : (e) => {
			throw e;
		}, this.instance = void 0, this.messagesBeforeLoad = [];
	}
	instantiate(e) {
		if (typeof this.onLoad == "function") return this.onLoad(e);
		throw Error("ThreadMessageHandler.prototype.instantiate is not implemented");
	}
	handle(e) {
		if (e?.data?.__emnapi__) {
			let t = e.data.__emnapi__.type, n = e.data.__emnapi__.payload;
			try {
				t === "load" ? this._load(n) : t === "start" && this.handleAfterLoad(e, () => {
					this._start(n);
				});
			} catch (e) {
				let r = t === "start" ? n.tid : void 0;
				this.reportError(e, t, r);
			}
		}
	}
	_load(e) {
		if (this.instance !== void 0) return;
		let t;
		try {
			t = this.instantiate(e);
		} catch (t) {
			this._loaded(t, null, e);
			return;
		}
		let n = t && "then" in t ? t.then : void 0;
		typeof n == "function" ? n.call(t, (t) => {
			this._loaded(null, t, e);
		}, (t) => {
			try {
				this._loaded(o(t), null, e);
			} catch (e) {
				this.reportError(e, "load");
			}
		}) : this._loaded(null, t, e);
	}
	_start(e) {
		let t = this.instance.exports.wasi_thread_start;
		if (typeof t != "function") {
			let t = /* @__PURE__ */ TypeError("wasi_thread_start is not exported");
			throw k(e.sab, 2, t), t;
		}
		let n = this.postMessage, r = e.tid, i = e.arg;
		k(e.sab, 1);
		try {
			t(r, i);
		} catch (e) {
			if (e !== "unwind") throw e;
			return;
		}
		n(m("cleanup-thread", { tid: r }));
	}
	_loaded(e, t, n) {
		if (e) throw k(n.sab, 2, e), this._failQueuedStarts(e), e;
		if (t == null) {
			let e = /* @__PURE__ */ TypeError("onLoad should return an object");
			throw k(n.sab, 2, e), this._failQueuedStarts(e), e;
		}
		let r = t.instance;
		if (!r) {
			let e = /* @__PURE__ */ TypeError("onLoad should return an object which includes \"instance\"");
			throw k(n.sab, 2, e), this._failQueuedStarts(e), e;
		}
		this.instance = r;
		let i = this.postMessage;
		i(m("loaded", {}));
		let a = this.messagesBeforeLoad;
		this.messagesBeforeLoad = [];
		for (let e = 0; e < a.length; e++) {
			let t = a[e];
			this.handle({ data: t });
		}
	}
	_failQueuedStarts(e) {
		this.messagesBeforeLoad = this.messagesBeforeLoad.filter((t) => t?.__emnapi__?.type !== "start" || (k(t.__emnapi__.payload.sab, 2, e), !1));
	}
	handleAfterLoad(e, t) {
		this.instance === void 0 ? this.messagesBeforeLoad.push(e.data) : t.call(this, e);
	}
	beforeReportError(e, t, n) {}
	reportError(e, t, n) {
		let r = o(e);
		this.beforeReportError(r, t, n);
		let a = t === "async-worker-init" ? "async-work" : t, c = () => {
			try {
				this.postMessage(m("thread-error", {
					error: s(r),
					phase: a,
					tid: n
				}));
			} catch {}
		};
		i ? (this.onError(r, t), c()) : (c(), this.onError(r, t));
	}
};
function k(e, t, n) {
	e && (l(e.buffer, t, n), Atomics.notify(e, 0));
}
//#endregion
//#region ../../node_modules/@emnapi/core/dist/emnapi-core.js
var A = /* @__PURE__ */ t({
	MessageHandler: () => he,
	ThreadManager: () => v,
	ThreadMessageHandler: () => te,
	WASIThreads: () => E,
	createAddonModule: () => re,
	createInstanceProxy: () => b,
	createNapiModule: () => ie,
	instantiateAddon: () => de,
	instantiateAddonSync: () => fe,
	instantiateNapiModule: () => pe,
	instantiateNapiModuleSync: () => me,
	isSharedArrayBuffer: () => f,
	isTrapError: () => p,
	loadAddon: () => se,
	loadAddonSync: () => ce,
	loadNapiModule: () => le,
	loadNapiModuleSync: () => ue,
	version: () => ge
}), j = typeof WebAssembly < "u" ? WebAssembly : typeof WXWebAssembly < "u" ? WXWebAssembly : void 0;
function M(e) {
	if (e && typeof e != "object") throw TypeError("imports must be an object or undefined");
	return !0;
}
function N(e, t) {
	if (!e) throw TypeError("Invalid wasm source");
	M(t), t ??= {};
	try {
		let n = typeof e == "object" && e && "then" in e ? e.then : void 0;
		if (typeof n == "function") return n.call(e, (e) => N(e, t));
	} catch {}
	if (e instanceof ArrayBuffer || ArrayBuffer.isView(e)) return j.instantiate(e, t);
	if (e instanceof j.Module) return j.instantiate(e, t).then((t) => ({
		instance: t,
		module: e
	}));
	if (typeof Response < "u" && e instanceof Response) return e.arrayBuffer().then((e) => j.instantiate(e, t));
	let n = typeof e == "string";
	if (n || typeof URL < "u" && e instanceof URL) {
		if (n && typeof wx < "u" && typeof __wxConfig < "u") return j.instantiate(e, t);
		if (typeof fetch != "function") throw TypeError("wasm source can not be a string or URL in this environment");
		if (typeof j.instantiateStreaming == "function") try {
			return j.instantiateStreaming(fetch(e), t).catch(() => N(fetch(e), t));
		} catch {
			return N(fetch(e), t);
		}
		return N(fetch(e), t);
	}
	throw TypeError("Invalid wasm source");
}
function ne(e, t) {
	if (!e) throw TypeError("Invalid wasm source");
	M(t), t ??= {};
	let n;
	if (e instanceof ArrayBuffer || ArrayBuffer.isView(e)) n = new j.Module(e);
	else if (e instanceof WebAssembly.Module) n = e;
	else throw TypeError("Invalid wasm source");
	return {
		instance: new j.Instance(n, t),
		module: n
	};
}
function re(e) {
	return (function() {
		function t(e) {
			let t = e.length;
			return [
				t % 128 | 128,
				t >> 7,
				...e
			];
		}
		function n(e) {
			let t = {
				i: "i32",
				j: "i64",
				f: "f32",
				d: "f64",
				e: "externref",
				p: "i32"
			}, n = {
				parameters: [],
				results: e[0] === "v" ? [] : [t[e[0]]]
			};
			for (let r = 1; r < e.length; ++r) n.parameters.push(t[e[r]]);
			return n;
		}
		let r = (function() {
			return {
				i: 127,
				p: 127,
				j: 126,
				f: 125,
				d: 124,
				e: 111
			};
		})();
		function i(e) {
			return t(Array.from(e, (e) => r[e]));
		}
		function a(e, r) {
			if (j.Function) return new j.Function(n(r), e);
			let a = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, ...t([
				1,
				96,
				...i(r.slice(1)),
				...i(r[0] === "v" ? "" : r[0])
			]), 2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0), o = new j.Module(a);
			return new j.Instance(o, { e: { f: e } }).exports.f;
		}
		let o = [], s;
		function c() {
			if (o.length) return o.pop();
			try {
				return b.grow(1);
			} catch (e) {
				throw e instanceof RangeError ? Error("Unable to grow wasm table. Specify `--growable-table` for wasm-ld.") : e;
			}
		}
		function l(e, t) {
			if (s) for (let n = e; n < e + t; n++) {
				let e = D(n);
				e && s.set(e, n);
			}
		}
		function u(e) {
			if (!s) {
				s = /* @__PURE__ */ new WeakMap();
				let e = b.length;
				e >>>= 0, l(0, e);
			}
			return s.get(e) || 0;
		}
		function d(e, t) {
			let n = u(e);
			if (n) return n;
			let r = c();
			try {
				O(r, e);
			} catch (n) {
				if (!(n instanceof TypeError)) throw n;
				if (!t) throw Error("Missing signature argument to addFunction: " + e);
				O(r, a(e, t));
			}
			return s.set(e, r), r;
		}
		function f(e) {
			s && (s.delete(D(e)), O(e, null), o.push(e));
		}
		var p = typeof process == "object" && process !== null && typeof process.versions == "object" && process.versions !== null && typeof process.versions.node == "string", m = !!e.childThread, h = typeof e.waitThreadStart == "number" ? e.waitThreadStart : !!e.waitThreadStart, g, _, y, b, x, S, C, w;
		function T(e) {
			throw typeof j.RuntimeError == "function" ? new j.RuntimeError(e) : Error(e);
		}
		function E() {}
		function ee() {}
		function D(e) {
			return b.get(e);
		}
		function O(e, t) {
			b.set(e, t);
		}
		function te(e, t, n, r) {
			e >>>= 0, e -= 8, r >>>= 0;
			var i = new DataView(y.buffer), a = () => i.buffer === y.buffer ? i : i = new DataView(y.buffer);
			return a().setInt32(e + 40, t, !0), a().setUint32(e + 36, n, !0), a().setUint32(e + 32, r, !0), t;
		}
		var k = {
			imports: {
				env: {},
				napi: {},
				emnapi: {}
			},
			exports: {},
			emnapi: {},
			loaded: !1,
			filename: "",
			childThread: m,
			initWorker: void 0,
			waitThreadStart: h,
			PThread: void 0,
			init(e) {
				if (k.loaded) return k.exports;
				if (!e) throw TypeError("Invalid napi init options");
				let t = e.instance;
				if (!t?.exports) throw TypeError("Invalid wasm instance");
				g = t;
				let n = t.exports, r = e.module, i = e.memory || n.memory, a = e.table || n.__indirect_function_table;
				if (!(r instanceof j.Module)) throw TypeError("Invalid wasm module");
				if (!(i instanceof j.Memory)) throw TypeError("Invalid wasm memory");
				if (!(a instanceof j.Table)) throw TypeError("Invalid wasm table");
				if (_ = r, y = i, b = a, typeof n.malloc != "function") throw TypeError("malloc is not exported");
				if (typeof n.free != "function") throw TypeError("free is not exported");
				if (x = n.malloc, S = n.free, C = n.emnapi_create_env, w = n.emnapi_delete_env, !k.childThread) {
					let e = "node_register_module_v137";
					var o = new DataView(y.buffer), s = () => o.buffer === y.buffer ? o : o = new DataView(y.buffer);
					if (typeof t.exports[e] == "function") {
						let n = A.isolate.openScope(), r = t.exports.malloc, i = t.exports.free, a = 0, o = 0;
						try {
							let c = k.exports, l = n.add(c), u = n.add(k);
							a = r(4), o = r(4), a >>>= 0, o >>>= 0;
							try {
								if (!a || !o) throw Error("Failed to allocate V8 local handle slots");
								s().setUint32(a, l, !0), s().setUint32(o, u, !0), t.exports[e](a, o, 5);
							} finally {
								o && i(o), a && i(a);
							}
						} catch (e) {
							if (e !== "unwind") throw e;
						} finally {
							A.isolate.closeScope(n);
						}
						return k.loaded = !0, delete k.envObject, k.exports;
					}
					let n = Object.keys(t.exports).filter((e) => e.startsWith("node_register_module_v"));
					if (n.length > 0) throw Error(`The module${k.filename ? ` '${k.filename}'` : ""}
    was compiled against a different Node.js version using
    NODE_MODULE_VERSION ${n[0].slice(22)}. This version of Node.js requires
    NODE_MODULE_VERSION 137.`);
					let r = 8, i = t.exports.node_api_module_get_api_version_v1;
					typeof i == "function" && (r = i());
					let a = k.envObject || (() => {
						let e = k.envObject = M = A.createEnv(k.filename, r, {
							address: () => {
								let e = C();
								if (e >>>= 0, !e) throw Error("Failed to create env");
								return e += 8, e;
							},
							deleteEnv: (e) => {
								w(e - 8);
							},
							setLastError: te,
							makeDynCall_vppp: (e) => b.get(e),
							makeDynCall_vp: (e) => b.get(e),
							abort: T
						}, N), t = e.address;
						return s().setUint32(t - 8 + 24, e.id, !0), e;
					})(), c = A.openScope(a);
					try {
						a.callIntoModule((e) => {
							let n = k.exports, r = a.address, i = c.add(n), o = t.exports.napi_register_wasm_v1, s = o(r, i);
							k.exports = s ? A.jsValueFromNapiValue(s) : n;
						});
					} catch (e) {
						if (e !== "unwind") throw e;
					} finally {
						A.closeScope(a, c);
					}
					return k.loaded = !0, delete k.envObject, k.exports;
				}
			}
		}, A, M, N, ne = void 0, re, ie;
		if (m) {
			A = e?.context;
			let t = typeof e.postMessage == "function" ? e.postMessage : typeof postMessage == "function" ? postMessage : void 0;
			if (typeof t != "function") throw TypeError("No postMessage found");
			k.postMessage = t;
		} else {
			let t = e.context;
			if (typeof t != "object" || !t) throw TypeError("Invalid `options.context`. Use `import { getDefaultContext } from '@emnapi/runtime'`");
			A = t;
		}
		if (typeof e.filename == "string" && (k.filename = e.filename), typeof e.onCreateWorker == "function" && (ne = e.onCreateWorker), re = typeof e.print == "function" ? e.print : console.log.bind(console), ie = typeof e.printErr == "function" ? e.printErr : console.warn.bind(console), "nodeBinding" in e) {
			let t = e.nodeBinding;
			if (typeof t != "object" || !t) throw TypeError("Invalid `options.nodeBinding`. Use @emnapi/node-binding package");
			N = t;
		}
		var P = 0;
		if ("asyncWorkPoolSize" in e) {
			if (typeof e.asyncWorkPoolSize != "number") throw TypeError("options.asyncWorkPoolSize must be a integer");
			P = e.asyncWorkPoolSize | 0, P > 1024 ? P = 1024 : P < -1024 && (P = -1024);
		}
		var ae = !m && P <= 0;
		function oe() {
			return Math.abs(P);
		}
		k.imports.env._emnapi_async_work_pool_size = oe;
		function se(e) {
			if (!e) return !1;
			if (e._emnapiSendListener) return !0;
			let t = function(e) {
				let t = (p ? e : e.data).__emnapi__;
				if (t && t.type === "async-send") {
					if (m) {
						let e = k.postMessage;
						e({ __emnapi__: t });
					} else {
						let { type: e, callback: n, data: r } = t.payload, i = () => b.get(n)(r);
						switch (e) {
							case 0:
								A.features.setImmediate(i);
								break;
							case 1: Promise.resolve().then(i);
						}
					}
				}
			};
			return e._emnapiSendListener = {
				handler: t,
				dispose: function() {
					p ? e.off("message", t) : e.removeEventListener("message", t, !1), delete e._emnapiSendListener;
				}
			}, p ? e.on("message", t) : e.addEventListener("message", t, !1), !0;
		}
		k.emnapi.addSendListener = se;
		var ce = new v(m ? {
			printErr: ie,
			childThread: !0
		} : {
			printErr: ie,
			beforeLoad: (e) => {
				se(e);
			},
			reuseWorker: e.reuseWorker,
			onCreateWorker: ne
		});
		k.PThread = ce;
		var le = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			ENVIRONMENT_IS_NODE: p,
			ENVIRONMENT_IS_PTHREAD: m,
			PThread: ce,
			_emnapi_async_work_pool_size: oe,
			get _emnapi_create_env() {
				return C;
			},
			get _emnapi_delete_env() {
				return w;
			},
			get _free() {
				return S;
			},
			get _malloc() {
				return x;
			},
			abort: T,
			addFunction: d,
			addonModule: k,
			get emnapiAsyncWorkPoolSize() {
				return P;
			},
			get emnapiCtx() {
				return A;
			},
			get emnapiEnv() {
				return M;
			},
			get emnapiNodeBinding() {
				return N;
			},
			get err() {
				return ie;
			},
			getWasmTableEntry: D,
			get onCreateWorker() {
				return ne;
			},
			get out() {
				return re;
			},
			removeFunction: f,
			runtimeKeepalivePop: ee,
			runtimeKeepalivePush: E,
			setWasmTableEntry: O,
			singleThreadAsyncWork: ae,
			waitThreadStart: h,
			get wasmInstance() {
				return g;
			},
			get wasmMemory() {
				return y;
			},
			get wasmModule() {
				return _;
			},
			get wasmTable() {
				return b;
			}
		});
		function ue() {
			return 0;
		}
		function de() {
			return 0;
		}
		function fe(e, t, n) {
			e >>>= 0, t >>>= 0, n >>>= 0;
			let r = typeof process == "object" && process !== null && typeof process.versions == "object" && process.versions !== null && typeof process.versions.node == "string" ? process.versions.node.split(".").map((e) => Number(e)) : [
				0,
				0,
				0
			];
			var i = new DataView(y.buffer), a = () => i.buffer === y.buffer ? i : i = new DataView(y.buffer);
			a().setUint32(e, r[0], !0), a().setUint32(t, r[1], !0), a().setUint32(n, r[2], !0);
		}
		function pe() {}
		function me() {}
		function he(e, t) {
			A.features.setImmediate(() => {
				b.get(e)(t);
			});
		}
		function ge(e, t) {
			Promise.resolve().then(() => {
				b.get(e)(t);
			});
		}
		function _e(e, t, n, r, i) {
			let a = M, o = A.openScope(a);
			try {
				a.callbackIntoModule(!!e, () => {
					b.get(n)(t, r);
				});
			} catch (e) {
				throw A.closeScope(a, o), i && A.closeScope(a), e;
			}
			A.closeScope(a, o);
		}
		function ve(e, t, n, r, i) {
			let a = M;
			n >>>= 0, a.callFinalizerInternal(e, n, r, i);
		}
		function ye() {
			A.increaseWaitingRequestCounter();
		}
		function be() {
			A.decreaseWaitingRequestCounter();
		}
		function xe() {
			return +!m;
		}
		function Se() {
			return +(typeof window < "u" && typeof document < "u" && !p);
		}
		function Ce() {
			throw "unwind";
		}
		function we() {
			return performance.timeOrigin + performance.now();
		}
		function Te(e, t) {
			let n, r = [t >>> 0, (n = t, +Math.abs(n) >= 1 ? n > 0 ? (Math.min(+Math.floor(n / 4294967296), 4294967295) | 0) >>> 0 : ~~+Math.ceil((n - +(~~n >>> 0)) / 4294967296) >>> 0 : 0)];
			var i = new DataView(y.buffer), a = () => i.buffer === y.buffer ? i : i = new DataView(y.buffer);
			a().setInt32(e, r[0], !0), a().setInt32(e + 4, r[1], !0);
		}
		function F() {
			return A.isolate.openScope().id;
		}
		function Ee(e) {
			return A.isolate.closeScope();
		}
		var De = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			$emnapiSetValueI64: Te,
			_emnapi_call_finalizer: ve,
			_emnapi_callback_into_module: _e,
			_emnapi_close_handle_scope: Ee,
			_emnapi_ctx_decrease_waiting_request_counter: be,
			_emnapi_ctx_increase_waiting_request_counter: ye,
			_emnapi_get_node_api_js_vtable: ue,
			_emnapi_get_node_api_module_vtable: de,
			_emnapi_get_node_version: fe,
			_emnapi_get_now: we,
			_emnapi_is_main_browser_thread: Se,
			_emnapi_is_main_runtime_thread: xe,
			_emnapi_next_tick: ge,
			_emnapi_open_handle_scope: F,
			_emnapi_runtime_keepalive_pop: me,
			_emnapi_runtime_keepalive_push: pe,
			_emnapi_set_immediate: he,
			_emnapi_unwind: Ce
		});
		function Oe(e) {
			let t = new DataView(y.buffer).getInt32(e + 20, !0);
			return ce.pthreads[t];
		}
		function ke(e) {
			if (m) return;
			e >>>= 0;
			let t = Oe(e);
			t && typeof t.ref == "function" && t.ref();
		}
		function Ae(e) {
			if (m) return;
			e >>>= 0;
			let t = Oe(e);
			t && typeof t.unref == "function" && t.unref();
		}
		function je(e, t, n) {
			if (m) {
				let r = k.postMessage;
				r({ __emnapi__: {
					type: "async-send",
					payload: {
						type: e,
						callback: t,
						data: n
					}
				} });
			} else switch (e) {
				case 0:
					he(t, n);
					break;
				case 1: ge(t, n);
			}
		}
		var Me, Ne = new Promise((e) => {
			Me = function() {
				Ne.ready = !0, e();
			};
		});
		Ne.ready = !1;
		function Pe(e, t, n) {
			Ne.ready ? b.get(e)(t, n) : Ne.then(() => {
				b.get(e)(t, n);
			});
		}
		function I(e, t) {
			let n = [];
			var r = new DataView(y.buffer), i = () => r.buffer === y.buffer ? r : r = new DataView(y.buffer);
			for (let r = 0; r < t; r++) {
				let t = Oe(i().getUint32(e + r * 4, !0));
				n.push(new Promise((e) => {
					let n = function(r) {
						let i = (p ? r : r.data).__emnapi__;
						i && i.type === "async-thread-ready" && (e(), t && typeof t.unref == "function" && t.unref(), p ? t.off("message", n) : t.removeEventListener("message", n));
					};
					p ? t.on("message", n) : t.addEventListener("message", n);
				}));
			}
			Promise.all(n).then(Me);
		}
		function Fe() {
			if (!m) return;
			let e = k.postMessage;
			e({ __emnapi__: {
				type: "async-thread-ready",
				payload: {}
			} });
		}
		var Ie = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			_emnapi_after_uvthreadpool_ready: Pe,
			_emnapi_async_send_js: je,
			_emnapi_emit_async_thread_ready: Fe,
			_emnapi_tell_js_uvthreadpool: I,
			_emnapi_worker_ref: ke,
			_emnapi_worker_unref: Ae
		});
		function Le(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (!n) return r.setLastError(1);
			let i = A.adjustAmountOfExternalAllocatedMemory(t);
			if (n >>>= 0, A.features.BigInt) {
				var a = new DataView(y.buffer);
				(a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setBigInt64(n, BigInt(i), !0);
			} else Te(n, Number(i));
			return r.clearLastError();
		}
		var Re = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_adjust_external_memory: Le
		});
		let L = {
			registry: typeof FinalizationRegistry == "function" ? new FinalizationRegistry(function(e) {
				S(e);
			}) : void 0,
			table: /* @__PURE__ */ new WeakMap(),
			backingStoreTable: /* @__PURE__ */ new Map(),
			wasmMemoryViewTable: /* @__PURE__ */ new WeakMap(),
			cachedMemoryBuffer: void 0,
			cachedHEAPU8: void 0,
			intrinsics: void 0,
			init: function() {
				L.registry = typeof FinalizationRegistry == "function" ? new FinalizationRegistry(function(e) {
					S(e);
				}) : void 0, L.table = /* @__PURE__ */ new WeakMap(), L.backingStoreTable = /* @__PURE__ */ new Map(), L.wasmMemoryViewTable = /* @__PURE__ */ new WeakMap(), L.cachedMemoryBuffer = void 0, L.cachedHEAPU8 = void 0;
				let e = typeof SharedArrayBuffer == "function" ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")?.get : void 0, t = typeof SharedArrayBuffer == "function" ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "maxByteLength")?.get : void 0;
				L.intrinsics = {
					isView: ArrayBuffer.isView,
					typedArray: {
						buffer: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "buffer").get,
						byteOffset: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteOffset").get,
						length: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get,
						tag: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get
					},
					dataView: {
						buffer: Object.getOwnPropertyDescriptor(DataView.prototype, "buffer").get,
						byteOffset: Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset").get,
						byteLength: Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength").get
					},
					arrayBuffer: {
						byteLength: Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get,
						maxByteLength: Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength")?.get
					},
					sharedArrayBuffer: e === void 0 ? void 0 : {
						byteLength: e,
						maxByteLength: t
					},
					ctors: {
						Int8Array,
						Uint8Array,
						Uint8ClampedArray,
						Int16Array,
						Uint16Array,
						Int32Array,
						Uint32Array,
						Float16Array: typeof Float16Array == "function" ? Float16Array : void 0,
						Float32Array,
						Float64Array,
						BigInt64Array,
						BigUint64Array
					},
					bufferFrom: void 0
				};
			},
			getHEAPU8: function() {
				let e = y.buffer;
				return (e !== L.cachedMemoryBuffer || L.cachedHEAPU8?.byteLength !== e.byteLength) && (L.cachedMemoryBuffer = e, L.cachedHEAPU8 = new Uint8Array(e)), L.cachedHEAPU8;
			},
			isSharedArrayBuffer(e) {
				let t = L.intrinsics.sharedArrayBuffer;
				if (t !== void 0) {
					if (typeof SharedArrayBuffer == "function" && e instanceof SharedArrayBuffer) return !0;
					try {
						return t.byteLength.call(e), !0;
					} catch {
						return !1;
					}
				}
				try {
					return L.intrinsics.arrayBuffer.byteLength.call(e), !1;
				} catch {}
				return Object.prototype.toString.call(e) === "[object SharedArrayBuffer]";
			},
			isDetachedArrayBuffer: function(e) {
				if (L.bufferByteLength(e) === 0) try {
					new Uint8Array(e);
				} catch {
					return !0;
				}
				return !1;
			},
			bufferByteLength: function(e) {
				let t = L.intrinsics;
				try {
					return t.arrayBuffer.byteLength.call(e);
				} catch (n) {
					let r = t.sharedArrayBuffer;
					if (r !== void 0) return r.byteLength.call(e);
					let i = Object.getPrototypeOf(e), a = i == null ? void 0 : Object.getOwnPropertyDescriptor(i, "byteLength")?.get;
					if (a === void 0) throw n;
					return a.call(e);
				}
			},
			bufferMaxByteLength: function(e) {
				let t = L.intrinsics;
				try {
					return t.arrayBuffer.maxByteLength?.call(e);
				} catch {
					return t.sharedArrayBuffer?.maxByteLength?.call(e);
				}
			},
			viewBuffer: function(e) {
				let t = L.intrinsics;
				return t.typedArray.tag.call(e) === void 0 ? t.dataView.buffer.call(e) : t.typedArray.buffer.call(e);
			},
			viewByteOffset: function(e) {
				let t = L.intrinsics;
				return t.typedArray.tag.call(e) === void 0 ? t.dataView.byteOffset.call(e) : t.typedArray.byteOffset.call(e);
			},
			viewLength: function(e) {
				let t = L.intrinsics;
				return t.typedArray.tag.call(e) === void 0 ? t.dataView.byteLength.call(e) : t.typedArray.length.call(e);
			},
			getBufferFrom: function() {
				return L.intrinsics.bufferFrom ?? (L.intrinsics.bufferFrom = A.features.Buffer.from);
			},
			setBackingStore: function(e, t, n, r) {
				L.backingStoreTable.set(e, {
					data: t,
					byteLength: n,
					arrayBuffer: r
				});
			},
			getBackingStoreData: function(e) {
				return L.backingStoreTable.get(e)?.data ?? 0;
			},
			getBackingStoreByteLength: function(e) {
				return L.backingStoreTable.get(e)?.byteLength ?? 0;
			},
			deleteBackingStore: function(e) {
				L.backingStoreTable.delete(e);
			},
			registerBufferAllocation: function(e, t, n) {
				let r = {
					Ctor: A.features.Buffer,
					address: t,
					length: n,
					ownership: +!L.registry,
					runtimeAllocated: 1
				};
				L.wasmMemoryViewTable.set(e, r), L.registry?.register(r, t);
			},
			getArrayBufferPointer: function(e, t) {
				let n = {
					address: 0,
					ownership: 0,
					runtimeAllocated: 0
				};
				if (e === y.buffer) return n;
				let r = L.isDetachedArrayBuffer(e), i = L.table.get(e);
				if (i !== void 0) {
					if (r) return i.address = 0, i;
					if (t && i.runtimeAllocated === 1) {
						let t = L.bufferByteLength(e), n = i.ownership === 1;
						if (t > (n ? i.copied : i.capacity)) {
							let r = n ? t : i.capacity * 2, a = L.bufferMaxByteLength(e);
							a !== void 0 && r > a && (r = a), r > 2130706432 && (r = 2130706432), r < t && (r = t);
							let o = x(r);
							if (!o && r !== t && (r = t, o = x(r)), !o) throw Error("Out of memory");
							o >>>= 0, i.address = o, i.capacity = r, L.registry?.register(e, o), L.getHEAPU8().set(new Uint8Array(e, 0, t), i.address);
						} else n || L.getHEAPU8().set(new Uint8Array(e, 0, t), i.address);
						i.copied = t;
					}
					return i;
				}
				let a = L.bufferByteLength(e);
				if (r || a === 0 || !t) return n;
				let o = x(a);
				if (!o) throw Error("Out of memory");
				return o >>>= 0, L.getHEAPU8().set(new Uint8Array(e, 0, a), o), n.address = o, n.ownership = +!L.registry, n.runtimeAllocated = 1, n.capacity = a, n.copied = a, L.table.set(e, n), L.registry?.register(e, o), n;
			},
			getOrUpdateMemoryView: function(e) {
				let t = L.intrinsics, n = t.typedArray.tag.call(e), r = n === void 0, i = r ? t.dataView.buffer.call(e) : t.typedArray.buffer.call(e);
				if (i === y.buffer) return L.wasmMemoryViewTable.get(e) === void 0 && L.wasmMemoryViewTable.set(e, {
					Ctor: r ? DataView : t.ctors[n],
					address: r ? t.dataView.byteOffset.call(e) : t.typedArray.byteOffset.call(e),
					length: r ? t.dataView.byteLength.call(e) : t.typedArray.length.call(e),
					ownership: 1,
					runtimeAllocated: 0
				}), e;
				let a = L.isDetachedArrayBuffer(i) || L.isSharedArrayBuffer(i) ? L.wasmMemoryViewTable.get(e) : void 0;
				if (a !== void 0) {
					let e = a, t = e.Ctor, n, r = A.features.Buffer;
					return n = typeof r == "function" && t === r ? L.getBufferFrom()(y.buffer, e.address, e.length) : new t(y.buffer, e.address, e.length), L.wasmMemoryViewTable.set(n, e), n;
				}
				return e;
			},
			getViewPointer: function(e, t) {
				e = L.getOrUpdateMemoryView(e);
				let n = L.wasmMemoryViewTable.get(e);
				if (n !== void 0) {
					let { address: t, ownership: r, runtimeAllocated: i } = n;
					return {
						address: t,
						ownership: r,
						runtimeAllocated: i,
						view: e
					};
				}
				let r = L.viewBuffer(e);
				if (r === y.buffer) return {
					address: L.viewByteOffset(e),
					ownership: 1,
					runtimeAllocated: 0,
					view: e
				};
				let { address: i, ownership: a, runtimeAllocated: o } = L.getArrayBufferPointer(r, t);
				return {
					address: i === 0 ? 0 : i + L.viewByteOffset(e),
					ownership: a,
					runtimeAllocated: o,
					view: e
				};
			},
			copyBytesFrom: function(e, t) {
				let n = L.table.get(e)?.copied;
				return n === void 0 ? Infinity : n > t ? n - t : 0;
			}
		}, R = {
			registry: void 0,
			handleTable: /* @__PURE__ */ new WeakMap(),
			init: function() {
				R.handleTable = /* @__PURE__ */ new WeakMap(), R.registry = typeof FinalizationRegistry == "function" ? new FinalizationRegistry(function(e) {
					R.release(e);
				}) : void 0;
			},
			allocMeta: function(e, t, n, r, i) {
				let a = x(24);
				if (!a) throw Error("Out of memory");
				a >>>= 0, Atomics.store(new Int32Array(y.buffer, a, 1), 0, 1);
				var o = new DataView(y.buffer), s = () => o.buffer === y.buffer ? o : o = new DataView(y.buffer);
				return s().setUint32(a + 4, e, !0), s().setUint32(a + 8, t, !0), s().setUint32(a + 12, n, !0), s().setUint32(a + 16, r, !0), s().setUint32(a + 20, i, !0), a;
			},
			readMeta: function(e) {
				var t = new DataView(y.buffer), n = () => t.buffer === y.buffer ? t : t = new DataView(y.buffer);
				return {
					external_data: n().getUint32(e + 4, !0),
					byte_length: n().getUint32(e + 8, !0),
					finalize_cb: n().getUint32(e + 12, !0),
					finalize_data: n().getUint32(e + 16, !0),
					finalize_hint: n().getUint32(e + 20, !0)
				};
			},
			release: function(e) {
				if (Atomics.sub(new Int32Array(y.buffer, e, 1), 0, 1) === 1) {
					let t = R.readMeta(e), n = t.finalize_cb;
					if (n) {
						let e = t.finalize_data, r = t.finalize_hint;
						b.get(n)(e, r);
					}
					S(e);
				}
			}
		};
		var z = {
			utf8Decoder: void 0,
			utf16Decoder: void 0,
			cachedMemoryBuffer: void 0,
			cachedHEAPU8: void 0,
			cachedHEAPU16: void 0,
			getHEAPU8() {
				let e = y.buffer;
				return (e !== z.cachedMemoryBuffer || z.cachedHEAPU8?.byteLength !== e.byteLength) && (z.cachedMemoryBuffer = e, z.cachedHEAPU8 = new Uint8Array(e), z.cachedHEAPU16 = void 0), z.cachedHEAPU8;
			},
			getHEAPU16() {
				return z.getHEAPU8(), z.cachedHEAPU16 === void 0 && (z.cachedHEAPU16 = new Uint16Array(z.cachedMemoryBuffer)), z.cachedHEAPU16;
			},
			getHeapViewOrCopy(e, t, n) {
				let r = e.buffer, i = Object.prototype.toString.call(r) === "[object SharedArrayBuffer]", a = r.resizable === !0;
				return i || a ? e.slice(t, n) : e.subarray(t, n);
			},
			init() {
				z.cachedMemoryBuffer = void 0, z.cachedHEAPU8 = void 0, z.cachedHEAPU16 = void 0;
				let e = { decode(e) {
					let t = 0, n = Math.min(4096, e.length + 1), r = new Uint16Array(n), i = [], a = 0;
					for (;;) {
						let o = t < e.length;
						if (!o || a >= n - 1) {
							let n = r.subarray(0, a);
							if (i.push(String.fromCharCode.apply(null, n)), !o) return i.join("");
							e = e.subarray(t), t = 0, a = 0;
						}
						let s = e[t++];
						if (!(s & 128)) r[a++] = s;
						else if ((s & 224) == 192) {
							let n = e[t++] & 63;
							r[a++] = (s & 31) << 6 | n;
						} else if ((s & 240) == 224) {
							let n = e[t++] & 63, i = e[t++] & 63;
							r[a++] = (s & 31) << 12 | n << 6 | i;
						} else if ((s & 248) == 240) {
							let n = e[t++] & 63, i = e[t++] & 63, o = e[t++] & 63, c = (s & 7) << 18 | n << 12 | i << 6 | o;
							c > 65535 && (c -= 65536, r[a++] = c >>> 10 & 1023 | 55296, c = 56320 | c & 1023), r[a++] = c;
						}
					}
				} }, t;
				t = typeof TextDecoder == "function" ? new TextDecoder() : e, z.utf8Decoder = t;
				let n = { decode(e) {
					let t = new Uint16Array(e.buffer, e.byteOffset, e.byteLength / 2);
					if (t.length <= 4096) return String.fromCharCode.apply(null, t);
					let n = [], r = 0, i = 0;
					for (; r < t.length; r += i) i = Math.min(4096, t.length - r), n.push(String.fromCharCode.apply(null, t.subarray(r, r + i)));
					return n.join("");
				} }, r;
				r = typeof TextDecoder == "function" ? new TextDecoder("utf-16le") : n, z.utf16Decoder = r;
			},
			lengthBytesUTF8(e) {
				let t, n = 0;
				for (let r = 0; r < e.length; ++r) t = e.charCodeAt(r), t <= 127 ? n++ : t <= 2047 ? n += 2 : t >= 55296 && t <= 57343 ? (n += 4, ++r) : n += 3;
				return n;
			},
			UTF8ToString(e, t) {
				if (!e || !t) return "";
				e >>>= 0;
				let n = z.getHEAPU8(), r = e;
				if (t === -1 || t === 4294967295) for (; n[r];) ++r;
				else r = e + (t >>> 0);
				if (t = r - e, t <= 16) {
					let t = e;
					for (var i = ""; t < r;) {
						var a = n[t++];
						if (!(a & 128)) i += String.fromCharCode(a);
						else {
							var o = n[t++] & 63;
							if ((a & 224) == 192) i += String.fromCharCode((a & 31) << 6 | o);
							else {
								var s = n[t++] & 63;
								if (a = (a & 240) == 224 ? (a & 15) << 12 | o << 6 | s : (a & 7) << 18 | o << 12 | s << 6 | n[t++] & 63, a < 65536) i += String.fromCharCode(a);
								else {
									var c = a - 65536;
									i += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
								}
							}
						}
					}
					return i;
				}
				return z.utf8Decoder.decode(z.getHeapViewOrCopy(n, e, r));
			},
			stringToUTF8(e, t, n) {
				let r = z.getHEAPU8(), i = t;
				if (i >>>= 0, !(n > 0)) return 0;
				for (var a = i, o = i + n - 1, s = 0; s < e.length; ++s) {
					var c = e.charCodeAt(s);
					if (c >= 55296 && c <= 57343) {
						var l = e.charCodeAt(++s);
						c = 65536 + ((c & 1023) << 10) | l & 1023;
					}
					if (c <= 127) {
						if (i >= o) break;
						r[i++] = c;
					} else if (c <= 2047) {
						if (i + 1 >= o) break;
						r[i++] = 192 | c >> 6, r[i++] = 128 | c & 63;
					} else if (c <= 65535) {
						if (i + 2 >= o) break;
						r[i++] = 224 | c >> 12, r[i++] = 128 | c >> 6 & 63, r[i++] = 128 | c & 63;
					} else {
						if (i + 3 >= o) break;
						r[i++] = 240 | c >> 18, r[i++] = 128 | c >> 12 & 63, r[i++] = 128 | c >> 6 & 63, r[i++] = 128 | c & 63;
					}
				}
				return r[i] = 0, i - a;
			},
			UTF16ToString(e, t) {
				if (!e || !t) return "";
				e >>>= 0;
				let n = e;
				if (t === -1 || t === 4294967295) {
					let e = n >>> 1, t = z.getHEAPU16();
					for (; t[e];) ++e;
					n = e << 1 >>> 0;
				} else n = e + (t >>> 0) * 2;
				if (t = n - e, t <= 32) return String.fromCharCode.apply(null, new Uint16Array(y.buffer, e, t / 2));
				let r = z.getHEAPU8();
				return z.utf16Decoder.decode(z.getHeapViewOrCopy(r, e, n));
			},
			stringToUTF16(e, t, n) {
				if (n === void 0 && (n = 2147483647), n < 2) return 0;
				n -= 2;
				for (var r = t, i = n < e.length * 2 ? n / 2 : e.length, a = new DataView(y.buffer), o = () => a.buffer === y.buffer ? a : a = new DataView(y.buffer), s = 0; s < i; ++s) {
					var c = e.charCodeAt(s);
					o().setInt16(t, c, !0), t += 2;
				}
				return o().setInt16(t, 0, !0), t - r;
			},
			newString(e, t, n, r, i) {
				if (n >>>= 0, !e) return 1;
				let a = M;
				a.checkGCAccess();
				let o = n === -1 || n === 4294967295, s = n >>> 0;
				if (n !== 0 && !t || !r || !(o || s <= 2147483647)) return a.setLastError(1);
				t >>>= 0;
				let c = i(t, o, s);
				r >>>= 0;
				let l = A.napiValueFromJsValue(c);
				var u = new DataView(y.buffer);
				return (u.buffer === y.buffer ? u : u = new DataView(y.buffer)).setUint32(r, l, !0), a.clearLastError();
			},
			newExternalString(e, t, n, r, i, a, o, s, c) {
				if (n >>>= 0, !e) return 1;
				let l = M;
				l.checkGCAccess();
				let u = n === -1 || n === 4294967295, d = n >>> 0;
				if (n !== 0 && !t || !a || !(u || d <= 2147483647)) return l.setLastError(1);
				let f = s(e, t, n, a);
				if (f === 0) {
					if (o) {
						var p = new DataView(y.buffer);
						(p.buffer === y.buffer ? p : p = new DataView(y.buffer)).setInt8(o, 1, !0);
					}
					r && l.callFinalizer(r, t, i);
				}
				return f;
			},
			encode(e, t, n, r) {
				let i = "", a = 0;
				var o = new DataView(y.buffer), s = () => o.buffer === y.buffer ? o : o = new DataView(y.buffer);
				if (t) for (;;) {
					let t = s().getUint8(e, !0);
					if (!t) break;
					i += r(t), e++;
				}
				else for (; a < n;) {
					let t = s().getUint8(e, !0);
					if (!t) break;
					i += r(t), a++, e++;
				}
				return i;
			}
		};
		function ze(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t || !n) return r.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (!Array.isArray(e)) return r.setLastError(8);
				n >>>= 0;
				let a = e.length >>> 0;
				var i = new DataView(y.buffer);
				return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(n, a, !0), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function Be(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !t) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(t);
			if (!(a instanceof ArrayBuffer) && !L.isSharedArrayBuffer(a)) return i.setLastError(1);
			let o = L.bufferByteLength(a);
			var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
			if (n) {
				n >>>= 0;
				let e = L.getArrayBufferPointer(a, !0).address;
				c().setUint32(n, e, !0);
			}
			return r && (r >>>= 0, c().setUint32(r, o, !0)), i.clearLastError();
		}
		function Ve(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!n) return r.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let i = typeof e, a;
				try {
					a = i === "object" && e !== null || i === "function" ? e : Object(e);
				} catch {
					return r.setLastError(2);
				}
				let o = A.jsValueFromNapiValue(n);
				return Object.setPrototypeOf(a, o), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function He(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t || !n) return r.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let a = typeof e, o;
				try {
					o = a === "object" && e !== null || a === "function" ? e : Object(e);
				} catch {
					return r.setLastError(2);
				}
				n >>>= 0;
				let s = A.napiValueFromJsValue(Object.getPrototypeOf(o));
				var i = new DataView(y.buffer);
				return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(n, s, !0), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function Ue(e, t, n, r, i, a, o) {
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !t) return s.setLastError(1);
			let c = A.jsValueFromNapiValue(t);
			if (!L.intrinsics.isView(c)) return s.setLastError(1);
			let l = c;
			var u = new DataView(y.buffer), d = () => u.buffer === y.buffer ? u : u = new DataView(y.buffer);
			if (n) {
				n >>>= 0;
				let e;
				switch (L.intrinsics.typedArray.tag.call(l)) {
					case "Int8Array":
						e = 0;
						break;
					case "Uint8Array":
						e = 1;
						break;
					case "Uint8ClampedArray":
						e = 2;
						break;
					case "Int16Array":
						e = 3;
						break;
					case "Uint16Array":
						e = 4;
						break;
					case "Int32Array":
						e = 5;
						break;
					case "Uint32Array":
						e = 6;
						break;
					case "Float16Array":
						e = 11;
						break;
					case "Float32Array":
						e = 7;
						break;
					case "Float64Array":
						e = 8;
						break;
					case "BigInt64Array":
						e = 9;
						break;
					case "BigUint64Array":
						e = 10;
						break;
					default: return s.setLastError(9);
				}
				d().setInt32(n, e, !0);
			}
			if (l = L.getOrUpdateMemoryView(l), r) {
				r >>>= 0;
				let e = L.viewLength(l);
				d().setUint32(r, e, !0);
			}
			if (i || a) {
				if (i) {
					i >>>= 0;
					let e = L.getViewPointer(l, !0);
					l = e.view;
					let t = e.address;
					d().setUint32(i, t, !0);
				}
				if (a) {
					a >>>= 0;
					let e = A.napiValueFromJsValue(L.viewBuffer(l));
					d().setUint32(a, e, !0);
				}
			}
			if (o) {
				o >>>= 0;
				let e = L.viewByteOffset(l);
				d().setUint32(o, e, !0);
			}
			return s.clearLastError();
		}
		function We(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !t) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(t), o = A.features.Buffer;
			return L.intrinsics.isView(a) || typeof o == "function" && o.isBuffer(a) ? L.intrinsics.typedArray.tag.call(a) === void 0 ? Ge(e, t, r, n, 0, 0) : Ue(e, t, 0, r, n, 0, 0) : i.setLastError(1);
		}
		function Ge(e, t, n, r, i, a) {
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !t) return o.setLastError(1);
			let s = A.jsValueFromNapiValue(t);
			if (!L.intrinsics.isView(s) || L.intrinsics.typedArray.tag.call(s) !== void 0) return o.setLastError(1);
			let c = L.getOrUpdateMemoryView(s);
			var l = new DataView(y.buffer), u = () => l.buffer === y.buffer ? l : l = new DataView(y.buffer);
			if (n) {
				n >>>= 0;
				let e = L.viewLength(c);
				u().setUint32(n, e, !0);
			}
			if (r || i) {
				if (r) {
					r >>>= 0;
					let e = L.getViewPointer(c, !0);
					c = e.view;
					let t = e.address;
					u().setUint32(r, t, !0);
				}
				if (i) {
					i >>>= 0;
					let e = A.napiValueFromJsValue(L.viewBuffer(c));
					u().setUint32(i, e, !0);
				}
			}
			if (a) {
				a >>>= 0;
				let e = L.viewByteOffset(c);
				u().setUint32(a, e, !0);
			}
			return o.clearLastError();
		}
		function Ke(e, t, n) {
			let r;
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!t || !n) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (!(e instanceof Date)) return i.setLastError(1);
				n >>>= 0, r = e.valueOf();
				var a = new DataView(y.buffer);
				return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setFloat64(n, r, !0), 0;
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function qe(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			if (typeof i != "boolean") return r.setLastError(7);
			n >>>= 0;
			let a = +!!i;
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Je(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			if (typeof i != "number") return r.setLastError(6);
			n >>>= 0;
			let a = i;
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setFloat64(n, a, !0), r.clearLastError();
		}
		function Ye(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !A.features.BigInt) return i.setLastError(9);
			if (!t || !n || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(t);
			if (typeof a != "bigint") return i.setLastError(6);
			r >>>= 0, n >>>= 0;
			let o = BigInt.asIntN(64, a), s = +(o === a);
			var c = new DataView(y.buffer), l = () => c.buffer === y.buffer ? c : c = new DataView(y.buffer);
			l().setInt8(r, s, !0);
			let u = Number(o & BigInt(4294967295)), d = Number(o >> BigInt(32));
			return l().setInt32(n, u, !0), l().setInt32(n + 4, d, !0), i.clearLastError();
		}
		function Xe(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !A.features.BigInt) return i.setLastError(9);
			if (!t || !n || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(t);
			if (typeof a != "bigint") return i.setLastError(6);
			r >>>= 0, n >>>= 0;
			let o = BigInt.asUintN(64, a), s = +(o === a);
			var c = new DataView(y.buffer), l = () => c.buffer === y.buffer ? c : c = new DataView(y.buffer);
			l().setInt8(r, s, !0);
			let u = Number(o & BigInt(4294967295)), d = Number(o >> BigInt(32));
			return l().setUint32(n, u, !0), l().setUint32(n + 4, d, !0), i.clearLastError();
		}
		function B(e, t, n, r, i) {
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !A.features.BigInt) return a.setLastError(9);
			if (!t || !r) return a.setLastError(1);
			let o = A.jsValueFromNapiValue(t);
			if (typeof o != "bigint") return a.setLastError(17);
			let s = o < BigInt(0);
			n >>>= 0, i >>>= 0, r >>>= 0;
			var c = new DataView(y.buffer), l = () => c.buffer === y.buffer ? c : c = new DataView(y.buffer);
			let u = l().getUint32(r, !0);
			u >>>= 0;
			let d = 0, f = s ? -o : o, p = f;
			for (; p !== BigInt(0);) d++, p >>= BigInt(64);
			if (!n && !i) u = d, l().setUint32(r, u, !0);
			else {
				if (!n || !i) return a.setLastError(1);
				p = f;
				let e = Math.min(u, d);
				for (let t = 0; t < e; t++) {
					let e = BigInt.asUintN(64, p), n = Number(e & BigInt(4294967295)), r = Number(e >> BigInt(32));
					l().setUint32(i + t * 8, n, !0), l().setUint32(i + (t * 8 + 4), r, !0), p >>= BigInt(64);
				}
				l().setInt32(n, +!!s, !0), l().setUint32(r, e, !0);
			}
			return a.clearLastError();
		}
		function Ze(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			if (!A.isExternal(i)) return r.setLastError(1);
			n >>>= 0;
			let a = A.getExternalValue(i);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(n, a, !0), r.clearLastError();
		}
		function Qe(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			if (typeof i != "number") return r.setLastError(6);
			n >>>= 0;
			let a = i | 0;
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt32(n, a, !0), r.clearLastError();
		}
		function $e(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			if (typeof i != "number") return r.setLastError(6);
			let a = i;
			n >>>= 0;
			var o = new DataView(y.buffer), s = () => o.buffer === y.buffer ? o : o = new DataView(y.buffer);
			return a === Infinity || a === -Infinity || isNaN(a) ? (s().setInt32(n, 0, !0), s().setInt32(n + 4, 0, !0)) : a < -0x8000000000000000 ? (s().setInt32(n, 0, !0), s().setInt32(n + 4, 2147483648, !0)) : a >= 0x8000000000000000 ? (s().setUint32(n, 4294967295, !0), s().setUint32(n + 4, 2147483647, !0)) : Te(n, Math.trunc(a)), r.clearLastError();
		}
		function et(e, t, n, r, i) {
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !t) return a.setLastError(1);
			i >>>= 0, n >>>= 0, r >>>= 0, r >>>= 0;
			let o = A.jsValueFromNapiValue(t);
			if (typeof o != "string") return a.setLastError(3);
			var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
			if (!n) {
				if (!i) return a.setLastError(1);
				c().setUint32(i, o.length, !0);
			} else if (r !== 0) {
				let e = Math.min(o.length, r - 1), t;
				for (let r = 0; r < e; ++r) t = o.charCodeAt(r) & 255, c().setUint8(n + r, t, !0);
				c().setUint8(n + e, 0, !0), i && c().setUint32(i, e, !0);
			} else i && c().setUint32(i, 0, !0);
			return a.clearLastError();
		}
		function tt(e, t, n, r, i) {
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !t) return a.setLastError(1);
			i >>>= 0, n >>>= 0, r >>>= 0, r >>>= 0;
			let o = A.jsValueFromNapiValue(t);
			if (typeof o != "string") return a.setLastError(3);
			var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
			if (!n) {
				if (!i) return a.setLastError(1);
				let e = z.lengthBytesUTF8(o);
				c().setUint32(i, e, !0);
			} else if (r !== 0) {
				let e = z.stringToUTF8(o, n, r);
				i && c().setUint32(i, e, !0);
			} else i && c().setUint32(i, 0, !0);
			return a.clearLastError();
		}
		function nt(e, t, n, r, i) {
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !t) return a.setLastError(1);
			i >>>= 0, n >>>= 0, r >>>= 0, r >>>= 0;
			let o = A.jsValueFromNapiValue(t);
			if (typeof o != "string") return a.setLastError(3);
			var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
			if (!n) {
				if (!i) return a.setLastError(1);
				c().setUint32(i, o.length, !0);
			} else if (r !== 0) {
				let e = z.stringToUTF16(o, n, r * 2);
				i && c().setUint32(i, e / 2, !0);
			} else i && c().setUint32(i, 0, !0);
			return a.clearLastError();
		}
		function rt(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			if (typeof i != "number") return r.setLastError(6);
			n >>>= 0;
			let a = i >>> 0;
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(n, a, !0), r.clearLastError();
		}
		var it = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_get_array_length: ze,
			napi_get_arraybuffer_info: Be,
			napi_get_buffer_info: We,
			napi_get_dataview_info: Ge,
			napi_get_date_value: Ke,
			napi_get_prototype: He,
			napi_get_typedarray_info: Ue,
			napi_get_value_bigint_int64: Ye,
			napi_get_value_bigint_uint64: Xe,
			napi_get_value_bigint_words: B,
			napi_get_value_bool: qe,
			napi_get_value_double: Je,
			napi_get_value_external: Ze,
			napi_get_value_int32: Qe,
			napi_get_value_int64: $e,
			napi_get_value_string_latin1: et,
			napi_get_value_string_utf16: nt,
			napi_get_value_string_utf8: tt,
			napi_get_value_uint32: rt,
			node_api_set_prototype: Ve
		});
		function at(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !n) return r.setLastError(1);
			n >>>= 0;
			let i = A.napiValueFromJsValue(t);
			var a = new DataView(y.buffer);
			return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0), r.clearLastError();
		}
		function ot(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !n) return r.setLastError(1);
			n >>>= 0;
			let i = A.napiValueFromJsValue(t >>> 0);
			var a = new DataView(y.buffer);
			return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0), r.clearLastError();
		}
		function st(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			i.checkGCAccess();
			let a;
			if (!n) return i.setLastError(1);
			a = Number(t);
			let o = A.napiValueFromJsValue(a);
			n >>>= 0;
			var s = new DataView(y.buffer);
			return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(n, o, !0), i.clearLastError();
		}
		function ct(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !n) return r.setLastError(1);
			n >>>= 0;
			let i = A.napiValueFromJsValue(t);
			var a = new DataView(y.buffer);
			return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0), r.clearLastError();
		}
		function V(e, t, n, r) {
			return z.newString(e, t, n, r, (e, t, n) => z.encode(e, t, n, (e) => String.fromCharCode(e)));
		}
		function lt(e, t, n, r) {
			return z.newString(e, t, n, r, (e) => z.UTF16ToString(e, n));
		}
		function ut(e, t, n, r) {
			return z.newString(e, t, n, r, (e) => z.UTF8ToString(e, n));
		}
		function dt(e, t, n, r, i, a, o) {
			return z.newExternalString(e, t, n, r, i, a, o, V, void 0);
		}
		function ft(e, t, n, r, i, a, o) {
			return z.newExternalString(e, t, n, r, i, a, o, lt, void 0);
		}
		function pt(e, t, n, r) {
			return V(e, t, n, r);
		}
		function mt(e, t, n, r) {
			return ut(e, t, n, r);
		}
		function ht(e, t, n, r) {
			return lt(e, t, n, r);
		}
		function gt(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !A.features.BigInt) return i.setLastError(9);
			let a;
			if (!n) return i.setLastError(1);
			a = t;
			let o = A.napiValueFromJsValue(a);
			n >>>= 0;
			var s = new DataView(y.buffer);
			return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(n, o, !0), i.clearLastError();
		}
		function _t(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !A.features.BigInt) return i.setLastError(9);
			let a;
			if (!n) return i.setLastError(1);
			a = BigInt.asUintN(64, t);
			let o = A.napiValueFromJsValue(a);
			n >>>= 0;
			var s = new DataView(y.buffer);
			return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(n, o, !0), i.clearLastError();
		}
		function vt(e, t, n, r, i) {
			let a, o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!A.features.BigInt) return s.setLastError(9);
				if (!i || (r >>>= 0, n >>>= 0, n >>>= 0, n > 2147483647)) return s.setLastError(1);
				if (n > 16384) throw RangeError("Maximum BigInt size exceeded");
				let e = BigInt(0);
				var c = new DataView(y.buffer), l = () => c.buffer === y.buffer ? c : c = new DataView(y.buffer);
				for (o = n; o > 0; --o) {
					let t = o - 1, n = l().getUint32(r + t * 8, !0), i = l().getUint32(r + (t * 8 + 4), !0), a = BigInt(n) | BigInt(i) << BigInt(32);
					e = e << BigInt(64) | a;
				}
				return t % 2 != 0 && (e = -e), i >>>= 0, a = A.napiValueFromJsValue(e), l().setUint32(i, a, !0), 0;
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		var yt = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_create_bigint_int64: gt,
			napi_create_bigint_uint64: _t,
			napi_create_bigint_words: vt,
			napi_create_double: ct,
			napi_create_int32: at,
			napi_create_int64: st,
			napi_create_string_latin1: V,
			napi_create_string_utf16: lt,
			napi_create_string_utf8: ut,
			napi_create_uint32: ot,
			node_api_create_external_string_latin1: dt,
			node_api_create_external_string_utf16: ft,
			node_api_create_property_key_latin1: pt,
			node_api_create_property_key_utf16: ht,
			node_api_create_property_key_utf8: mt
		});
		function bt(e, t, n, r, i) {
			t >>>= 0;
			let a = !t || !n ? "" : z.UTF8ToString(t, n);
			return a ? /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(a) ? {
				status: 0,
				f: A.createFunction(e, b.get(r), i, a, !0)
			} : {
				status: 1,
				f: void 0
			} : {
				status: 0,
				f: A.createFunction(e, b.get(r), i, a, !0)
			};
		}
		function xt(e, t, n, r, i, a, o, s, c) {
			if (i || a) {
				let r, o;
				i && (r = bt(e, 0, 0, i, c).f), a && (o = bt(e, 0, 0, a, c).f);
				let l = {
					configurable: !!(s & 4),
					enumerable: !!(s & 2),
					get: r,
					set: o
				};
				Object.defineProperty(t, n, l);
			} else if (r) {
				let i = bt(e, 0, 0, r, c).f, a = {
					configurable: !!(s & 4),
					enumerable: !!(s & 2),
					writable: !!(s & 1),
					value: i
				};
				Object.defineProperty(t, n, a);
			} else {
				let e = {
					configurable: !!(s & 4),
					enumerable: !!(s & 2),
					writable: !!(s & 1),
					value: A.jsValueFromNapiValue(o)
				};
				Object.defineProperty(t, n, e);
			}
		}
		function St(e) {
			let t = A.jsValueFromNapiValue(e), n = typeof t;
			return n === "object" && t !== null || n === "function" ? (L !== void 0 && ArrayBuffer.isView(t) && L.wasmMemoryViewTable.has(t) && (t = L.wasmMemoryViewTable.get(t)), {
				status: 0,
				value: t
			}) : { status: 1 };
		}
		function Ct(e, t, n, r, i, a) {
			let o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!A.features.finalizer) {
					if (r) throw A.createNotSupportWeakRefError("napi_wrap", "Parameter \"finalize_cb\" must be 0(NULL)");
					if (a) throw A.createNotSupportWeakRefError("napi_wrap", "Parameter \"result\" must be 0(NULL)");
				}
				if (!t) return s.setLastError(1);
				let e = St(t);
				if (e.status !== 0) return s.setLastError(e.status);
				let l = e.value;
				if (s.getObjectBinding(l).wrapped !== 0) return s.setLastError(1);
				let u = A.napiValueFromJsValue(l), d;
				if (a) {
					if (!r) return s.setLastError(1);
					d = A.createReferenceWithFinalizer(s, u, 0, 1, r, n, i), a >>>= 0, o = d.id;
					var c = new DataView(y.buffer);
					(c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(a, o, !0);
				} else d = r ? A.createReferenceWithFinalizer(s, u, 0, 0, r, n, i) : A.createReferenceWithData(s, u, 0, 0, n);
				return s.getObjectBinding(l).wrapped = d.id, 0;
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		function wt(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t || r === 0 && !n) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t), s = typeof e;
				if (!(s === "object" && e !== null || s === "function")) return a.setLastError(1);
				let c = a.getObjectBinding(e), l = c.wrapped, u = A.getRef(l);
				if (!u) return a.setLastError(1);
				if (n) {
					n >>>= 0, i = u.data();
					var o = new DataView(y.buffer);
					(o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(n, i, !0);
				}
				return r === 1 && (c.wrapped = 0, u.ownership() === 1 ? u.resetFinalizer() : u.dispose()), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function Tt(e, t, n, r, i, a, o, s) {
			let c, l, u;
			if (!e) return 1;
			let d = M;
			if (d.checkGCAccess(), !d.lastException.isEmpty()) return d.setLastError(10);
			if (!d.canCallIntoJs()) return d.setLastError(d.moduleApiVersion >= 10 ? 23 : 10);
			d.clearLastError();
			try {
				if (!s || !r || (n >>>= 0, o >>>= 0, a >>>= 0, a >>>= 0, a > 0 && !o) || !(n >= -1 && n <= 2147483647 || n === 4294967295) || !t) return d.setLastError(1);
				let e = bt(d, t, n, r, i);
				if (e.status !== 0) return d.setLastError(e.status);
				let m = e.f, h;
				var f = new DataView(y.buffer), p = () => f.buffer === y.buffer ? f : f = new DataView(y.buffer);
				for (let e = 0; e < a; e++) {
					c = o + e * 32;
					let t = p().getUint32(c, !0), n = p().getUint32(c + 4, !0), r = p().getUint32(c + 8, !0), i = p().getUint32(c + 12, !0), a = p().getUint32(c + 16, !0), s = p().getUint32(c + 20, !0);
					u = p().getInt32(c + 24, !0), u >>>= 0;
					let l = p().getUint32(c + 28, !0);
					if (t) h = z.UTF8ToString(t, -1);
					else if (!n || (h = A.jsValueFromNapiValue(n), typeof h != "string" && typeof h != "symbol")) return d.setLastError(4);
					u & 1024 ? xt(d, m, h, r, i, a, s, u, l) : xt(d, m.prototype, h, r, i, a, s, u, l);
				}
				return l = A.napiValueFromJsValue(m), s >>>= 0, p().setUint32(s, l, !0), 0;
			} catch (e) {
				return d.lastException.resetTo(e), d.setLastError(10);
			}
		}
		function Et(e, t, n, r, i, a) {
			return Ct(e, t, n, r, i, a);
		}
		function Dt(e, t, n) {
			return wt(e, t, n, 0);
		}
		function Ot(e, t, n) {
			return wt(e, t, n, 1);
		}
		function kt(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t) return r.setLastError(r.lastException.isEmpty() ? 1 : 10);
				let e = A.jsValueFromNapiValue(t), i = typeof e;
				if (!(i === "object" && e !== null || i === "function")) return r.setLastError(r.lastException.isEmpty() ? 2 : 10);
				if (n >>>= 0, !n) return r.setLastError(r.lastException.isEmpty() ? 1 : 10);
				let a = r.getObjectBinding(e);
				if (a.tag !== null) return r.setLastError(r.lastException.isEmpty() ? 1 : 10);
				let o = /* @__PURE__ */ new Uint8Array(16);
				return o.set(new Uint8Array(y.buffer, n, 16)), a.tag = new Uint32Array(o.buffer), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function At(e, t, n, r) {
			let i = !0;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t) return a.setLastError(a.lastException.isEmpty() ? 1 : 10);
				let e = A.jsValueFromNapiValue(t), s = typeof e;
				if (!(s === "object" && e !== null || s === "function")) return a.setLastError(a.lastException.isEmpty() ? 2 : 10);
				if (!n || !r) return a.setLastError(a.lastException.isEmpty() ? 1 : 10);
				let c = a.getObjectBinding(e);
				if (c.tag !== null) {
					n >>>= 0;
					let e = c.tag, t = new Uint32Array(y.buffer, n, 4);
					i = e[0] === t[0] && e[1] === t[1] && e[2] === t[2] && e[3] === t[3];
				} else i = !1;
				r >>>= 0;
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, +!!i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function jt(e, t, n, r, i, a) {
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !A.features.finalizer) return o.setLastError(9);
			if (!t || !r) return o.setLastError(1);
			let s = St(t);
			if (s.status !== 0) return o.setLastError(s.status);
			let c = A.napiValueFromJsValue(s.value), l = +!!a;
			n >>>= 0, r >>>= 0, i >>>= 0;
			let u = A.createReferenceWithFinalizer(o, c, 0, l, r, n, i);
			if (a) {
				a >>>= 0;
				let e = u.id;
				var d = new DataView(y.buffer);
				(d.buffer === y.buffer ? d : d = new DataView(y.buffer)).setUint32(a, e, !0);
			}
			return o.clearLastError();
		}
		function Mt(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			return i.enqueueFinalizer(A.createTrackedFinalizer(i, t, n, r)), i.clearLastError();
		}
		var Nt = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_add_finalizer: jt,
			napi_check_object_type_tag: At,
			napi_define_class: Tt,
			napi_remove_wrap: Ot,
			napi_type_tag_object: kt,
			napi_unwrap: Dt,
			napi_wrap: Et,
			node_api_post_finalizer: Mt
		});
		function Pt(e, t, n, r, i) {
			n >>>= 0, e >>>= 0;
			let a = n ? z.UTF8ToString(n, -1) : "", o = [`[emnapi_debug] ${z.UTF8ToString(e, -1)}:${t} ${a} ${r}`];
			r && o.push(i === 1 ? A.isolate.getRef(r) : A.jsValueFromNapiValue(r)), console.log(...o);
		}
		function Ft(e, t, n, r, i, a, o) {
			let s;
			if (!e) return 1;
			let c = M;
			if (c.checkGCAccess(), !c.lastException.isEmpty()) return c.setLastError(10);
			if (!c.canCallIntoJs()) return c.setLastError(c.moduleApiVersion >= 10 ? 23 : 10);
			c.clearLastError();
			try {
				if (!o) return c.setLastError(1);
				if (r >>>= 0, n >>>= 0, o >>>= 0, r >>>= 0, n || (r = 0), r > 2147483647) throw RangeError("Cannot create a memory view larger than 2147483647 bytes");
				if (n + r > y.buffer.byteLength) throw RangeError("Memory out of range");
				if (!A.features.finalizer && i) throw A.createNotSupportWeakRefError("emnapi_create_memory_view", "Parameter \"finalize_cb\" must be 0(NULL)");
				let u;
				switch (t) {
					case 0:
						u = {
							Ctor: Int8Array,
							address: n,
							length: r,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 1:
						u = {
							Ctor: Uint8Array,
							address: n,
							length: r,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 2:
						u = {
							Ctor: Uint8ClampedArray,
							address: n,
							length: r,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 3:
						u = {
							Ctor: Int16Array,
							address: n,
							length: r >> 1,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 4:
						u = {
							Ctor: Uint16Array,
							address: n,
							length: r >> 1,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 5:
						u = {
							Ctor: Int32Array,
							address: n,
							length: r >> 2,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 6:
						u = {
							Ctor: Uint32Array,
							address: n,
							length: r >> 2,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 7:
						u = {
							Ctor: Float32Array,
							address: n,
							length: r >> 2,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 8:
						u = {
							Ctor: Float64Array,
							address: n,
							length: r >> 3,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 9:
						u = {
							Ctor: BigInt64Array,
							address: n,
							length: r >> 3,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 10:
						u = {
							Ctor: BigUint64Array,
							address: n,
							length: r >> 3,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case -1:
						u = {
							Ctor: DataView,
							address: n,
							length: r,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case 11:
						if (typeof Float16Array != "function") return c.setLastError(1);
						u = {
							Ctor: Float16Array,
							address: n,
							length: r >> 1,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					case -2:
						if (!A.features.Buffer) throw A.createNotSupportBufferError("emnapi_create_memory_view", "");
						u = {
							Ctor: A.features.Buffer,
							address: n,
							length: r,
							ownership: 1,
							runtimeAllocated: 0
						};
						break;
					default: return c.setLastError(1);
				}
				let d = u.Ctor, f = t === -2 ? L.getBufferFrom()(y.buffer, u.address, u.length) : new d(y.buffer, u.address, u.length);
				if (s = A.napiValueFromJsValue(f), L.wasmMemoryViewTable.set(f, u), i) {
					let t = jt(e, s, n, i, a, 0);
					if (t === 10) {
						let e = c.lastException.deref();
						throw c.clearLastError(), c.lastException.reset(), e;
					}
					if (t !== 0) return c.setLastError(t);
				}
				var l = new DataView(y.buffer);
				return (l.buffer === y.buffer ? l : l = new DataView(y.buffer)).setUint32(o, s, !0), 0;
			} catch (e) {
				return c.lastException.resetTo(e), c.setLastError(10);
			}
		}
		function It() {
			return +!!A.features.finalizer;
		}
		function H() {
			return +!!A.features.BigInt;
		}
		function Lt() {
			return +!!N;
		}
		function Rt(e, t, n, r) {
			n ??= 0, n >>>= 0;
			let i;
			if (t instanceof ArrayBuffer || L.isSharedArrayBuffer(t)) {
				let a = L.getArrayBufferPointer(t, !1).address;
				if (!a) throw Error("Unknown ArrayBuffer address");
				let o = L.copyBytesFrom(t, 0);
				if ((typeof r != "number" || r === -1 || r === 4294967295) && (r = Math.min(t.byteLength - n, o)), r >>>= 0, r === 0) return t;
				if (i = new Uint8Array(t, n, r), r > o) throw RangeError("The range is larger than the wasm copy of the buffer");
				let s = L.getHEAPU8();
				return e ? s.set(i, a) : i.set(s.subarray(a, a + r)), t;
			}
			if (ArrayBuffer.isView(t)) {
				let a = L.getViewPointer(t, !1), o = a.view, s = a.address;
				if (!s) throw Error("Unknown ArrayBuffer address");
				let c = L.copyBytesFrom(L.viewBuffer(o), L.viewByteOffset(o));
				if ((typeof r != "number" || r === -1 || r === 4294967295) && (r = Math.min(o.byteLength - n, c)), r >>>= 0, r === 0) return o;
				if (i = new Uint8Array(o.buffer, o.byteOffset + n, r), r > c) throw RangeError("The range is larger than the wasm copy of the buffer");
				let l = L.getHEAPU8();
				return e ? l.set(i, s) : i.set(l.subarray(s, s + r)), o;
			}
			throw TypeError("emnapiSyncMemory expect ArrayBuffer or ArrayBufferView as first parameter");
		}
		function zt(e, t, n, r, i) {
			let a;
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				if (!n) return o.setLastError(1);
				n >>>= 0, r >>>= 0, i >>>= 0;
				var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
				let e = c().getUint32(n, !0), l = A.jsValueFromNapiValue(e), u = l instanceof ArrayBuffer, d = l instanceof DataView;
				if (!u && (!ArrayBuffer.isView(l) || d) && !d && !L.isSharedArrayBuffer(l)) return o.setLastError(1);
				let f = Rt(!!t, l, r, i);
				return l !== f && (n >>>= 0, a = A.napiValueFromJsValue(f), c().setUint32(n, a, !0)), 0;
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function Bt(e) {
			let t = e instanceof ArrayBuffer, n = e instanceof DataView;
			if (!t && (!ArrayBuffer.isView(e) || n) && !n && !L.isSharedArrayBuffer(e)) throw TypeError("emnapiGetMemoryAddress expect ArrayBuffer or ArrayBufferView as first parameter");
			let r;
			return r = t ? L.getArrayBufferPointer(e, !1) : L.getViewPointer(e, !1), {
				address: r.address,
				ownership: r.ownership,
				runtimeAllocated: r.runtimeAllocated
			};
		}
		function Vt(e, t, n, r, i) {
			let a, o, s, c;
			if (!e) return 1;
			let l = M;
			if (l.checkGCAccess(), !l.lastException.isEmpty()) return l.setLastError(10);
			if (!l.canCallIntoJs()) return l.setLastError(l.moduleApiVersion >= 10 ? 23 : 10);
			l.clearLastError();
			try {
				if (!t || !n && !r && !i) return l.setLastError(1);
				c = Bt(A.jsValueFromNapiValue(t)), a = c.address;
				var u = new DataView(y.buffer), d = () => u.buffer === y.buffer ? u : u = new DataView(y.buffer);
				return n && (n >>>= 0, d().setUint32(n, a, !0)), r && (r >>>= 0, s = c.ownership, d().setInt32(r, s, !0)), i && (i >>>= 0, o = c.runtimeAllocated, d().setInt8(i, o, !0)), 0;
			} catch (e) {
				return l.lastException.resetTo(e), l.setLastError(10);
			}
		}
		function Ht(e, t) {
			if (!e) return 1;
			let n = M;
			if (!t) return n.setLastError(1);
			let r;
			try {
				r = A.getRuntimeVersions().version;
			} catch {
				return n.setLastError(9);
			}
			let i = r.split(".").map((e) => Number(e));
			t >>>= 0;
			var a = new DataView(y.buffer), o = () => a.buffer === y.buffer ? a : a = new DataView(y.buffer);
			return o().setUint32(t, i[0], !0), o().setUint32(t + 4, i[1], !0), o().setUint32(t + 8, i[2], !0), n.clearLastError();
		}
		function Ut(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t || !n) return r.setLastError(1);
				n >>>= 0;
				let e = A.jsValueFromNapiValue(t);
				if (!L.isSharedArrayBuffer(e)) return r.setLastError(1);
				let a = R.handleTable.get(e);
				if (a === void 0) return r.setLastError(1);
				let o = a;
				var i = new DataView(y.buffer);
				return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(n, o, !0), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function Wt(e) {
			e >>>= 0, Atomics.add(new Int32Array(y.buffer, e, 1), 0, 1);
		}
		function U(e) {
			e >>>= 0, R.release(e);
		}
		function Gt(e, t) {
			if (t != null && !L.isSharedArrayBuffer(t)) throw TypeError("Expected a SharedArrayBuffer");
			if (!R.registry) throw Error("FinalizationRegistry is not supported in this environment");
			e >>>= 0;
			let n = R.readMeta(e), r = n.external_data;
			if (r >>>= 0, t == null) t = new SharedArrayBuffer(n.byte_length), new Uint8Array(t).set(L.getHEAPU8().subarray(r, r + n.byte_length));
			else if (R.handleTable.has(t)) return t;
			return Atomics.add(new Int32Array(y.buffer, e, 1), 0, 1), L.table.has(t) || r && L.table.set(t, {
				address: r,
				ownership: 1,
				runtimeAllocated: 0
			}), R.handleTable.set(t, e), R.registry.register(t, e), t;
		}
		var Kt = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			$emnapiAcquireExternalSharedArrayBuffer: Gt,
			$emnapiGetMemoryAddress: Bt,
			$emnapiSyncMemory: Rt,
			emnapi_acquire_external_sharedarraybuffer: Wt,
			emnapi_create_memory_view: Ft,
			emnapi_debug: Pt,
			emnapi_get_external_sharedarraybuffer_handle: Ut,
			emnapi_get_memory_address: Vt,
			emnapi_get_runtime_version: Ht,
			emnapi_is_node_binding_available: Lt,
			emnapi_is_support_bigint: H,
			emnapi_is_support_weakref: It,
			emnapi_release_external_sharedarraybuffer: U,
			emnapi_sync_memory: zt
		});
		function qt(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			t >>>= 0;
			let r = A.napiValueFromJsValue([]);
			var i = new DataView(y.buffer);
			return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(t, r, !0), n.clearLastError();
		}
		function Jt(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !n) return r.setLastError(1);
			t >>>= 0, n >>>= 0, t >>>= 0;
			let i = A.napiValueFromJsValue(Array(t));
			var a = new DataView(y.buffer);
			return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0), r.clearLastError();
		}
		function Yt(e, t, n) {
			e >>>= 0, e >>>= 0;
			let r = n ? new SharedArrayBuffer(e) : new ArrayBuffer(e);
			if (t) {
				t >>>= 0;
				let e = L.getArrayBufferPointer(r, !0).address;
				var i = new DataView(y.buffer);
				(i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(t, e, !0);
			}
			return r;
		}
		function W(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!r) return a.setLastError(1);
				r >>>= 0;
				let e = Yt(t, n, !1);
				i = A.napiValueFromJsValue(e);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function G(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!r) return a.setLastError(1);
				r >>>= 0;
				let e = Yt(t, n, !0);
				i = A.napiValueFromJsValue(e);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function Xt(e, t, n) {
			let r;
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!n) return i.setLastError(1);
				n >>>= 0, r = A.napiValueFromJsValue(new Date(t));
				var a = new DataView(y.buffer);
				return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, r, !0), 0;
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function K(e, t, n, r, i) {
			let a;
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				if (!i) return o.setLastError(1);
				if (!A.features.finalizer && n) throw A.createNotSupportWeakRefError("napi_create_external", "Parameter \"finalize_cb\" must be 0(NULL)");
				a = A.getCurrentScope().addExternal(t), n && A.createReferenceWithFinalizer(o, a, 0, 0, n, t, r), i >>>= 0;
				var s = new DataView(y.buffer);
				return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(i, a, !0), o.clearLastError();
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function Zt(e, t, n, r, i, a) {
			let o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!a) return s.setLastError(1);
				if (n >>>= 0, t >>>= 0, a >>>= 0, n >>>= 0, t || (n = 0), t + n > y.buffer.byteLength) throw RangeError("Memory out of range");
				if (!A.features.finalizer && r) throw A.createNotSupportWeakRefError("napi_create_external_arraybuffer", "Parameter \"finalize_cb\" must be 0(NULL)");
				let l = new ArrayBuffer(n);
				if (n === 0) try {
					let e = A.features.MessageChannel;
					new e().port1.postMessage(l, [l]);
				} catch {}
				else new Uint8Array(l).set(L.getHEAPU8().subarray(t, t + n)), L.table.set(l, {
					address: t,
					ownership: 1,
					runtimeAllocated: 0
				});
				if (o = A.napiValueFromJsValue(l), r) {
					let n = jt(e, o, t, r, i, 0);
					if (n === 10) {
						let e = s.lastException.deref();
						throw s.clearLastError(), s.lastException.reset(), e;
					}
					if (n !== 0) return s.setLastError(n);
				}
				var c = new DataView(y.buffer);
				return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(a, o, !0), 0;
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		function Qt(e, t, n, r, i, a) {
			let o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!a) return s.setLastError(1);
				if (n >>>= 0, t >>>= 0, a >>>= 0, n >>>= 0, t || (n = 0), t + n > y.buffer.byteLength) throw RangeError("Memory out of range");
				if (!R.registry && r) throw A.createNotSupportWeakRefError("node_api_create_external_sharedarraybuffer", "Parameter \"finalize_cb\" must be 0(NULL)");
				let e = new SharedArrayBuffer(n);
				if (n !== 0 && (new Uint8Array(e).set(L.getHEAPU8().subarray(t, t + n)), L.table.set(e, {
					address: t,
					ownership: 1,
					runtimeAllocated: 0
				})), o = A.napiValueFromJsValue(e), r) {
					r >>>= 0, i >>>= 0;
					let a = R.allocMeta(t, n, r, t, i);
					R.handleTable.set(e, a), R.registry.register(e, a);
				}
				var c = new DataView(y.buffer);
				return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(a, o, !0), 0;
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		function $t(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			t >>>= 0;
			let r = A.napiValueFromJsValue({});
			var i = new DataView(y.buffer);
			return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(t, r, !0), n.clearLastError();
		}
		function en(e, t, n, r, i, a) {
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !a || (i >>>= 0, i >>>= 0, i > 0 && (!n || !r))) return o.setLastError(1);
			let s = t ? A.jsValueFromNapiValue(t) : null, c = {};
			n >>>= 0, r >>>= 0;
			var l = new DataView(y.buffer), u = () => l.buffer === y.buffer ? l : l = new DataView(y.buffer);
			for (let e = 0; e < i; e++) {
				let t = A.jsValueFromNapiValue(u().getUint32(n + e * 4, !0));
				if (typeof t != "string" && typeof t != "symbol") return o.setLastError(4);
				c[t] = {
					value: A.jsValueFromNapiValue(u().getUint32(r + e * 4, !0)),
					writable: !0,
					enumerable: !0,
					configurable: !0
				};
			}
			let d;
			try {
				d = Object.defineProperties(Object.create(s), c);
			} catch {
				return o.setLastError(9);
			}
			let f = A.napiValueFromJsValue(d);
			return a >>>= 0, u().setUint32(a, f, !0), o.clearLastError();
		}
		function tn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !n) return r.setLastError(1);
			n >>>= 0;
			var i = new DataView(y.buffer), a = () => i.buffer === y.buffer ? i : i = new DataView(y.buffer);
			if (t) {
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "string") return r.setLastError(3);
				let i = A.napiValueFromJsValue(Symbol(e));
				a().setUint32(n, i, !0);
			} else {
				let e = A.napiValueFromJsValue(Symbol());
				a().setUint32(n, e, !0);
			}
			return r.clearLastError();
		}
		function nn(e, t, n, r, i, a) {
			let o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!r || !a) return s.setLastError(1);
				let e = A.jsValueFromNapiValue(r);
				i >>>= 0, n >>>= 0;
				let c = function(e, t, n, r, i, s) {
					if (i >>>= 0, s >>>= 0, n > 1 && i % n !== 0) {
						let r = /* @__PURE__ */ RangeError(`start offset of ${t.name ?? ""} should be a multiple of ${n}`);
						return r.code = "ERR_NAPI_INVALID_TYPEDARRAY_ALIGNMENT", e.lastException.resetTo(r), e.setLastError(9);
					}
					if (s * n + i > r.byteLength) {
						let t = /* @__PURE__ */ RangeError("Invalid typed array length");
						return t.code = "ERR_NAPI_INVALID_TYPEDARRAY_LENGTH", e.lastException.resetTo(t), e.setLastError(9);
					}
					let c = new t(r, i, s);
					r === y.buffer && (L.wasmMemoryViewTable.has(c) || L.wasmMemoryViewTable.set(c, {
						Ctor: t,
						address: i,
						length: s,
						ownership: 1,
						runtimeAllocated: 0
					})), a >>>= 0, o = A.napiValueFromJsValue(c);
					var l = new DataView(y.buffer);
					return (l.buffer === y.buffer ? l : l = new DataView(y.buffer)).setUint32(a, o, !0), 0;
				};
				if (e instanceof ArrayBuffer || L.isSharedArrayBuffer(e)) switch (t) {
					case 0: return c(s, Int8Array, 1, e, i, n);
					case 1: return c(s, Uint8Array, 1, e, i, n);
					case 2: return c(s, Uint8ClampedArray, 1, e, i, n);
					case 3: return c(s, Int16Array, 2, e, i, n);
					case 4: return c(s, Uint16Array, 2, e, i, n);
					case 5: return c(s, Int32Array, 4, e, i, n);
					case 6: return c(s, Uint32Array, 4, e, i, n);
					case 7: return c(s, Float32Array, 4, e, i, n);
					case 8: return c(s, Float64Array, 8, e, i, n);
					case 9: return c(s, BigInt64Array, 8, e, i, n);
					case 10: return c(s, BigUint64Array, 8, e, i, n);
					case 11: return typeof Float16Array == "function" ? c(s, Float16Array, 2, e, i, n) : s.setLastError(1);
					default: return s.setLastError(1);
				}
				else return s.setLastError(1);
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		function rn(e, t, n, r) {
			let i, a;
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				if (!r) return o.setLastError(1);
				let e = A.features.Buffer;
				if (!e) throw A.createNotSupportBufferError("napi_create_buffer", "");
				r >>>= 0;
				let l;
				t >>>= 0, t >>>= 0;
				var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
				if (!n || t === 0) l = e.alloc(t), i = A.napiValueFromJsValue(l), c().setUint32(r, i, !0);
				else {
					if (a = x(t), !a) throw Error("Out of memory");
					a >>>= 0, L.getHEAPU8().subarray(a, a + t).fill(0);
					let o = L.getBufferFrom()(y.buffer, a, t), s = {
						Ctor: e,
						address: a,
						length: t,
						ownership: +!L.registry,
						runtimeAllocated: 1
					};
					L.wasmMemoryViewTable.set(o, s), L.registry?.register(s, a), i = A.napiValueFromJsValue(o), c().setUint32(r, i, !0), n >>>= 0, c().setUint32(n, a, !0);
				}
				return 0;
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function an(e, t, n, r, i) {
			let a;
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				if (!i) return o.setLastError(1);
				let e = A.features.Buffer;
				if (!e) throw A.createNotSupportBufferError("napi_create_buffer_copy", "");
				let c = Yt(t, r, !1), l = e.from(c);
				n >>>= 0, t >>>= 0, l.set(L.getHEAPU8().subarray(n, n + t)), a = A.napiValueFromJsValue(l), i >>>= 0;
				var s = new DataView(y.buffer);
				return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(i, a, !0), 0;
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function on(e, t, n, r, i, a) {
			return Ft(e, -2, n, t, r, i, a);
		}
		function sn(e, t, n, r, i) {
			let a;
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				if (!t || !i) return o.setLastError(1);
				n >>>= 0, r >>>= 0, n >>>= 0, r >>>= 0;
				let e = A.jsValueFromNapiValue(t);
				if (!(e instanceof ArrayBuffer)) return o.setLastError(1);
				if (r + n > e.byteLength) {
					let e = /* @__PURE__ */ RangeError("The byte offset + length is out of range");
					throw e.code = "ERR_OUT_OF_RANGE", e;
				}
				let c = A.features.Buffer;
				if (!c) throw A.createNotSupportBufferError("node_api_create_buffer_from_arraybuffer", "");
				let l = L.getBufferFrom()(e, n, r);
				e === y.buffer && (L.wasmMemoryViewTable.has(l) || L.wasmMemoryViewTable.set(l, {
					Ctor: c,
					address: n,
					length: r,
					ownership: 1,
					runtimeAllocated: 0
				})), i >>>= 0, a = A.napiValueFromJsValue(l);
				var s = new DataView(y.buffer);
				return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(i, a, !0), 0;
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function cn(e, t, n, r, i) {
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!n || !i) return a.setLastError(1);
				t >>>= 0, r >>>= 0, t >>>= 0, r >>>= 0;
				let e = A.jsValueFromNapiValue(n);
				return e instanceof ArrayBuffer || L.isSharedArrayBuffer(e) ? ((e) => {
					if (t + r > e.byteLength) {
						let e = /* @__PURE__ */ RangeError("byte_offset + byte_length should be less than or equal to the size in bytes of the array passed in");
						throw e.code = "ERR_NAPI_INVALID_DATAVIEW_ARGS", e;
					}
					let n = new DataView(e, r, t);
					e === y.buffer && (L.wasmMemoryViewTable.has(n) || L.wasmMemoryViewTable.set(n, {
						Ctor: DataView,
						address: r,
						length: t,
						ownership: 1,
						runtimeAllocated: 0
					})), i >>>= 0;
					let a = A.napiValueFromJsValue(n);
					var o = new DataView(y.buffer);
					return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(i, a, !0), 0;
				})(e) : a.setLastError(1);
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function ln(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !r) return i.setLastError(1);
			n >>>= 0, t >>>= 0, r >>>= 0;
			let a = n === -1 || n === 4294967295, o = n >>> 0;
			if (n !== 0 && !t || !(a || o <= 2147483647)) return i.setLastError(1);
			let s = z.UTF8ToString(t, n), c = A.napiValueFromJsValue(Symbol.for(s));
			var l = new DataView(y.buffer);
			return (l.buffer === y.buffer ? l : l = new DataView(y.buffer)).setUint32(r, c, !0), i.clearLastError();
		}
		var un = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_create_array: qt,
			napi_create_array_with_length: Jt,
			napi_create_arraybuffer: W,
			napi_create_buffer: rn,
			napi_create_buffer_copy: an,
			napi_create_dataview: cn,
			napi_create_date: Xt,
			napi_create_external: K,
			napi_create_external_arraybuffer: Zt,
			napi_create_external_buffer: on,
			napi_create_object: $t,
			napi_create_symbol: tn,
			napi_create_typedarray: nn,
			node_api_create_buffer_from_arraybuffer: sn,
			node_api_create_external_sharedarraybuffer: Qt,
			node_api_create_object_with_properties: en,
			node_api_create_sharedarraybuffer: G,
			node_api_symbol_for: ln
		});
		function dn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !n) return r.setLastError(1);
			n >>>= 0;
			let i = t === 0 ? 4 : 5;
			var a = new DataView(y.buffer);
			return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0), r.clearLastError();
		}
		function fn(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			t >>>= 0;
			var r = new DataView(y.buffer);
			return (r.buffer === y.buffer ? r : r = new DataView(y.buffer)).setUint32(t, 6, !0), n.clearLastError();
		}
		function pn(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			t >>>= 0;
			var r = new DataView(y.buffer);
			return (r.buffer === y.buffer ? r : r = new DataView(y.buffer)).setUint32(t, 3, !0), n.clearLastError();
		}
		function mn(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			t >>>= 0;
			var r = new DataView(y.buffer);
			return (r.buffer === y.buffer ? r : r = new DataView(y.buffer)).setUint32(t, 2, !0), n.clearLastError();
		}
		var hn = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_get_boolean: dn,
			napi_get_global: fn,
			napi_get_null: pn,
			napi_get_undefined: mn
		});
		function gn(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			return t >>>= 0, n >>>= 0, r >>>= 0, i.setInstanceData(t, n, r), i.clearLastError();
		}
		function _n(e, t) {
			if (!e) return 1;
			let n = M;
			if (!t) return n.setLastError(1);
			t >>>= 0;
			let r = n.getInstanceData();
			var i = new DataView(y.buffer);
			return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(t, r, !0), n.clearLastError();
		}
		var vn = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_get_instance_data: _n,
			napi_set_instance_data: gn
		});
		function yn(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !n.lastException.isEmpty()) return n.setLastError(10);
			if (!n.canCallIntoJs()) return n.setLastError(n.moduleApiVersion >= 10 ? 23 : 10);
			n.clearLastError();
			try {
				return t ? (n.lastException.resetTo(A.jsValueFromNapiValue(t)), n.clearLastError()) : n.setLastError(1);
			} catch (e) {
				return n.lastException.resetTo(e), n.setLastError(10);
			}
		}
		function bn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!n) return r.setLastError(1);
				t >>>= 0, n >>>= 0;
				let e = Error(z.UTF8ToString(n, -1));
				return t && (e.code = z.UTF8ToString(t, -1)), r.lastException.resetTo(e), r.clearLastError();
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function xn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!n) return r.setLastError(1);
				t >>>= 0, n >>>= 0;
				let e = TypeError(z.UTF8ToString(n, -1));
				return t && (e.code = z.UTF8ToString(t, -1)), r.lastException.resetTo(e), r.clearLastError();
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function Sn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!n) return r.setLastError(1);
				t >>>= 0, n >>>= 0;
				let e = RangeError(z.UTF8ToString(n, -1));
				return t && (e.code = z.UTF8ToString(t, -1)), r.lastException.resetTo(e), r.clearLastError();
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function Cn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!n) return r.setLastError(1);
				t >>>= 0, n >>>= 0;
				let e = SyntaxError(z.UTF8ToString(n, -1));
				return t && (e.code = z.UTF8ToString(t, -1)), r.lastException.resetTo(e), r.clearLastError();
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function wn(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			let r = !n.lastException.isEmpty();
			t >>>= 0;
			var i = new DataView(y.buffer);
			return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setInt8(t, +!!r, !0), n.clearLastError();
		}
		function Tn(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !n || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(n);
			if (typeof a != "string") return i.setLastError(3);
			let o = Error(a);
			if (t) {
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "string") return i.setLastError(3);
				o.code = e;
			}
			r >>>= 0;
			let s = A.napiValueFromJsValue(o);
			var c = new DataView(y.buffer);
			return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(r, s, !0), i.clearLastError();
		}
		function En(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !n || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(n);
			if (typeof a != "string") return i.setLastError(3);
			let o = TypeError(a);
			if (t) {
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "string") return i.setLastError(3);
				o.code = e;
			}
			r >>>= 0;
			let s = A.napiValueFromJsValue(o);
			var c = new DataView(y.buffer);
			return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(r, s, !0), i.clearLastError();
		}
		function Dn(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !n || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(n);
			if (typeof a != "string") return i.setLastError(3);
			let o = RangeError(a);
			if (t) {
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "string") return i.setLastError(3);
				o.code = e;
			}
			r >>>= 0;
			let s = A.napiValueFromJsValue(o);
			var c = new DataView(y.buffer);
			return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(r, s, !0), i.clearLastError();
		}
		function On(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !n || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(n);
			if (typeof a != "string") return i.setLastError(3);
			let o = SyntaxError(a);
			if (t) {
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "string") return i.setLastError(3);
				o.code = e;
			}
			r >>>= 0;
			let s = A.napiValueFromJsValue(o);
			var c = new DataView(y.buffer);
			return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(r, s, !0), i.clearLastError();
		}
		function q(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			t >>>= 0;
			var r = new DataView(y.buffer), i = () => r.buffer === y.buffer ? r : r = new DataView(y.buffer);
			if (n.lastException.isEmpty()) return i().setUint32(t, 1, !0), n.clearLastError();
			{
				let e = n.lastException.deref(), r = A.napiValueFromJsValue(e);
				i().setUint32(t, r, !0), n.lastException.reset();
			}
			return n.clearLastError();
		}
		function kn(e, t, n, r) {
			e >>>= 0, t >>>= 0, n >>>= 0, r >>>= 0;
			let i = z.UTF8ToString(e, t), a = z.UTF8ToString(n, r);
			N ? N.napi.fatalError(i, a) : T("FATAL ERROR: " + i + " " + a);
		}
		function An(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !n.lastException.isEmpty()) return n.setLastError(10);
			if (!n.canCallIntoJs()) return n.setLastError(n.moduleApiVersion >= 10 ? 23 : 10);
			n.clearLastError();
			try {
				if (!t) return n.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				try {
					n.triggerFatalException(e);
				} catch {
					return n.setLastError(9);
				}
				return n.clearLastError();
			} catch (e) {
				return n.lastException.resetTo(e), n.setLastError(10);
			}
		}
		var J = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_create_error: Tn,
			napi_create_range_error: Dn,
			napi_create_type_error: En,
			napi_fatal_error: kn,
			napi_fatal_exception: An,
			napi_get_and_clear_last_exception: q,
			napi_is_exception_pending: wn,
			napi_throw: yn,
			napi_throw_error: bn,
			napi_throw_range_error: Sn,
			napi_throw_type_error: xn,
			node_api_create_syntax_error: On,
			node_api_throw_syntax_error: Cn
		});
		function Y(e, t, n, r, i) {
			t >>>= 0;
			let a = bt(M, e, t, n, r);
			if (a.status !== 0) return M.setLastError(a.status);
			let o = a.f, s = A.napiValueFromJsValue(o);
			i >>>= 0;
			var c = new DataView(y.buffer);
			return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(i, s, !0), 0;
		}
		function jn(e, t, n, r, i, a) {
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				return !a || !r ? o.setLastError(1) : Y(t, n, r, i, a);
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function Mn(e, t, n, r, i, a) {
			if (!e) return 1;
			let o = M;
			if (!t) return o.setLastError(1);
			let s = A.getCallbackInfo(t);
			n >>>= 0, r >>>= 0;
			var c = new DataView(y.buffer), l = () => c.buffer === y.buffer ? c : c = new DataView(y.buffer);
			if (r) {
				if (!n) return o.setLastError(1);
				let e = l().getUint32(n, !0);
				e >>>= 0;
				let t = s.args.length, i = e < t ? e : t, a = 0;
				for (; a < i; a++) {
					let e = A.napiValueFromJsValue(s.args[a]);
					l().setUint32(r + a * 4, e, !0);
				}
				if (a < e) for (; a < e; a++) l().setUint32(r + a * 4, 1, !0);
			}
			if (n && l().setUint32(n, s.args.length, !0), i) {
				i >>>= 0;
				let e = A.napiValueFromJsValue(s.thiz);
				l().setUint32(i, e, !0);
			}
			return a && (a >>>= 0, l().setUint32(a, s.data, !0)), o.clearLastError();
		}
		function Nn(e, t, n, r, i, a) {
			let o = 0, s;
			if (!e) return 1;
			let c = M;
			if (c.checkGCAccess(), !c.lastException.isEmpty()) return c.setLastError(10);
			if (!c.canCallIntoJs()) return c.setLastError(c.moduleApiVersion >= 10 ? 23 : 10);
			c.clearLastError();
			try {
				if (!t || (r >>>= 0, i >>>= 0, a >>>= 0, r >>>= 0, r > 0 && !i)) return c.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (!n) return c.setLastError(1);
				let d = A.jsValueFromNapiValue(n);
				if (typeof d != "function") return c.setLastError(1);
				let f = [];
				for (var l = new DataView(y.buffer), u = () => l.buffer === y.buffer ? l : l = new DataView(y.buffer); o < r; o++) {
					let e = u().getUint32(i + o * 4, !0);
					f.push(A.jsValueFromNapiValue(e));
				}
				let p = d.apply(e, f);
				return a && (s = A.napiValueFromJsValue(p), u().setUint32(a, s, !0)), c.clearLastError();
			} catch (e) {
				return c.lastException.resetTo(e), c.setLastError(10);
			}
		}
		function X(e, t, n, r, i) {
			let a, o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!t || (n >>>= 0, r >>>= 0, i >>>= 0, n >>>= 0, n > 0 && !r) || !i) return s.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "function") return s.setLastError(1);
				let u;
				var c = new DataView(y.buffer), l = () => c.buffer === y.buffer ? c : c = new DataView(y.buffer);
				if (A.features.Reflect) {
					let t = Array(n);
					for (a = 0; a < n; a++) {
						let e = l().getUint32(r + a * 4, !0);
						t[a] = A.jsValueFromNapiValue(e);
					}
					u = A.features.Reflect.construct(e, t, e);
				} else {
					let t = Array(n + 1);
					for (t[0] = void 0, a = 0; a < n; a++) {
						let e = l().getUint32(r + a * 4, !0);
						t[a + 1] = A.jsValueFromNapiValue(e);
					}
					u = new (e.bind.apply(e, t))();
				}
				return i && (o = A.napiValueFromJsValue(u), l().setUint32(i, o, !0)), 0;
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		function Pn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			n >>>= 0;
			let { thiz: i, fn: a } = A.getCallbackInfo(t), o = i == null || typeof a != "function" ? 0 : i instanceof a ? A.napiValueFromJsValue(a) : 0;
			var s = new DataView(y.buffer);
			return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setUint32(n, o, !0), r.clearLastError();
		}
		var Fn = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			_emnapi_create_function: Y,
			napi_call_function: Nn,
			napi_create_function: jn,
			napi_get_cb_info: Mn,
			napi_get_new_target: Pn,
			napi_new_instance: X
		});
		function Z(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			let r = A.openScope(n);
			t >>>= 0;
			var i = new DataView(y.buffer);
			return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(t, r.id, !0), n.clearLastError();
		}
		function Q(e, t) {
			if (!e) return 1;
			let n = M;
			return n.checkGCAccess(), t ? n.openHandleScopes === 0 ? 13 : (A.closeScope(n), n.clearLastError()) : n.setLastError(1);
		}
		function In(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			let r = A.openScope(n);
			t >>>= 0;
			var i = new DataView(y.buffer);
			return (i.buffer === y.buffer ? i : i = new DataView(y.buffer)).setUint32(t, r.id, !0), n.clearLastError();
		}
		function Ln(e, t) {
			if (!e) return 1;
			let n = M;
			return n.checkGCAccess(), t ? n.openHandleScopes === 0 ? 13 : (A.closeScope(n), n.clearLastError()) : n.setLastError(1);
		}
		function Rn(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !t || !n || !r) return i.setLastError(1);
			let a = A.getHandleScope(t);
			if (!a.escapeCalled()) {
				n >>>= 0, r >>>= 0;
				let e = a.escape(n);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(r, e, !0), i.clearLastError();
			}
			return i.setLastError(12);
		}
		function zn(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !t || !r) return i.setLastError(1);
			let a = A.jsValueFromNapiValue(t), o = typeof a;
			if (i.moduleApiVersion < 10 && !(o === "object" && a !== null || o === "function" || typeof a == "symbol")) return i.setLastError(1);
			let s = A.createReference(i, t, n >>> 0, 1);
			r >>>= 0;
			var c = new DataView(y.buffer);
			return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(r, s.id, !0), i.clearLastError();
		}
		function Bn(e, t) {
			if (!e) return 1;
			let n = M;
			return t ? (A.getRef(t).dispose(), n.clearLastError()) : n.setLastError(1);
		}
		function Vn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t) return r.setLastError(1);
			let i = A.getRef(t).ref();
			if (n) {
				n >>>= 0;
				var a = new DataView(y.buffer);
				(a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0);
			}
			return r.clearLastError();
		}
		function Hn(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t) return r.setLastError(1);
			let i = A.getRef(t);
			if (i.refcount() === 0) return r.setLastError(9);
			let a = i.unref();
			if (n) {
				n >>>= 0;
				var o = new DataView(y.buffer);
				(o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(n, a, !0);
			}
			return r.clearLastError();
		}
		function Un(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.getRef(t).get();
			n >>>= 0;
			var a = new DataView(y.buffer);
			return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, i, !0), r.clearLastError();
		}
		function Wn(e, t, n) {
			if (!e) return 1;
			let r = M;
			return t ? (t >>>= 0, n >>>= 0, A.addCleanupHook(r, t, n), 0) : r.setLastError(1);
		}
		function Gn(e, t, n) {
			if (!e) return 1;
			let r = M;
			return t ? (t >>>= 0, n >>>= 0, A.removeCleanupHook(r, t, n), 0) : r.setLastError(1);
		}
		function Kn(e) {
			M.ref();
		}
		function qn(e) {
			M.unref();
		}
		var Jn = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			_emnapi_env_ref: Kn,
			_emnapi_env_unref: qn,
			napi_add_env_cleanup_hook: Wn,
			napi_close_escapable_handle_scope: Ln,
			napi_close_handle_scope: Q,
			napi_create_reference: zn,
			napi_delete_reference: Bn,
			napi_escape_handle: Rn,
			napi_get_reference_value: Un,
			napi_open_escapable_handle_scope: In,
			napi_open_handle_scope: Z,
			napi_reference_ref: Vn,
			napi_reference_unref: Hn,
			napi_remove_env_cleanup_hook: Gn
		});
		function Yn(e, t, n) {
			let r = M.filename;
			return t ? (t >>>= 0, z.stringToUTF8(r, t, n)) : z.lengthBytesUTF8(r);
		}
		var Xn = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			_emnapi_get_filename: Yn
		});
		function Zn(e, t, n, r) {
			var i = new DataView(y.buffer), a = () => i.buffer === y.buffer ? i : i = new DataView(y.buffer);
			if (!N) {
				r && (r >>>= 0, a().setFloat64(r, 0, !0), a().setFloat64(r + 8, n, !0));
				return;
			}
			let o = A.jsValueFromNapiValue(e), s = A.jsValueFromNapiValue(t), c = N.node.emitAsyncInit(o, s, n), l = c.asyncId, u = c.triggerAsyncId;
			r && (r >>>= 0, a().setFloat64(r, l, !0), a().setFloat64(r + 8, u, !0));
		}
		function Qn(e, t) {
			N && N.node.emitAsyncDestroy({
				asyncId: e,
				triggerAsyncId: t
			});
		}
		function $n(e, t, n, r, i, a, o, s) {
			let c = 0, l, u = A.jsValueFromNapiValue(t), d = A.jsValueFromNapiValue(n);
			r >>>= 0, i >>>= 0, i >>>= 0;
			let f = Array(i);
			for (var p = new DataView(y.buffer), m = () => p.buffer === y.buffer ? p : p = new DataView(y.buffer); c < i; c++) {
				let e = m().getUint32(r + c * 4, !0);
				f[c] = A.jsValueFromNapiValue(e);
			}
			if (!N) try {
				let e = d.apply(u, f);
				if (s) {
					s >>>= 0;
					let t = A.napiValueFromJsValue(e);
					m().setUint32(s, t, !0);
				}
				return 0;
			} catch (e) {
				return A.isolate.throwException(e), 9;
			}
			let h = N.node.makeCallback(u, d, f, {
				asyncId: a,
				triggerAsyncId: o
			});
			return s && (s >>>= 0, l = A.napiValueFromJsValue(h), m().setUint32(s, l, !0)), 0;
		}
		function er(e, t, n) {
			if (!N) return 9;
			let r;
			e && (r = Object(A.jsValueFromNapiValue(e)));
			let i = A.jsValueFromNapiValue(t), a = N.napi.asyncInit(r, i);
			if (a.status !== 0) return a.status;
			let o = a.value;
			o >= BigInt(-1) * (BigInt(1) << BigInt(63)) && o < BigInt(1) << BigInt(63) || (o &= (BigInt(1) << BigInt(64)) - BigInt(1), o >= BigInt(1) << BigInt(63) && (o -= BigInt(1) << BigInt(64)));
			let s = Number(o & BigInt(4294967295)), c = Number(o >> BigInt(32));
			n >>>= 0;
			var l = new DataView(y.buffer), u = () => l.buffer === y.buffer ? l : l = new DataView(y.buffer);
			return u().setInt32(n, s, !0), u().setInt32(n + 4, c, !0), 0;
		}
		function tr(e) {
			if (!N) return 9;
			e >>>= 0;
			var t = new DataView(y.buffer), n = () => t.buffer === y.buffer ? t : t = new DataView(y.buffer);
			let r = n().getInt32(e, !0), i = n().getInt32(e + 4, !0), a = BigInt(r >>> 0) | BigInt(i) << BigInt(32), o = N.napi.asyncDestroy(a);
			return o.status === 0 ? 0 : o.status;
		}
		function nr(e, t, n, r) {
			throw Error("napi_open_callback_scope has not been implemented yet");
		}
		function rr(e, t) {
			throw Error("napi_close_callback_scope has not been implemented yet");
		}
		function ir(e, t, n, r, i, a, o) {
			let s = 0, c;
			if (!e) return 1;
			let l = M;
			if (l.checkGCAccess(), !l.lastException.isEmpty()) return l.setLastError(10);
			if (!l.canCallIntoJs()) return l.setLastError(l.moduleApiVersion >= 10 ? 23 : 10);
			l.clearLastError();
			try {
				if (!N) return l.setLastError(9);
				if (!n || i > 0 && !a) return l.setLastError(1);
				let e = Object(A.jsValueFromNapiValue(n)), f = A.jsValueFromNapiValue(r);
				if (typeof f != "function") return l.setLastError(1);
				t >>>= 0;
				var u = new DataView(y.buffer), d = () => u.buffer === y.buffer ? u : u = new DataView(y.buffer);
				let p = d().getInt32(t, !0), m = d().getInt32(t + 4, !0), h = BigInt(p >>> 0) | BigInt(m) << BigInt(32);
				a >>>= 0, i >>>= 0, i >>>= 0;
				let g = Array(i);
				for (; s < i; s++) {
					let e = d().getUint32(a + s * 4, !0);
					g[s] = A.jsValueFromNapiValue(e);
				}
				let _ = N.napi.makeCallback(h, e, f, g);
				if (_.error) throw _.error;
				return _.status === 0 ? (o && (o >>>= 0, c = A.napiValueFromJsValue(_.value), d().setUint32(o, c, !0)), 0) : l.setLastError(_.status);
			} catch (e) {
				return l.lastException.resetTo(e), l.setLastError(10);
			}
		}
		function ar(e) {
			M.checkGCAccess();
		}
		var or = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			_emnapi_async_destroy_js: tr,
			_emnapi_async_init_js: er,
			_emnapi_env_check_gc_access: ar,
			_emnapi_node_emit_async_destroy: Qn,
			_emnapi_node_emit_async_init: Zn,
			_emnapi_node_make_callback: $n,
			napi_close_callback_scope: rr,
			napi_make_callback: ir,
			napi_open_callback_scope: nr
		});
		function sr(e, t, n) {
			let r, i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t || !n) return a.setLastError(1);
				let e = A.createResolver();
				r = A.isolate.createReference(e).id, t >>>= 0;
				var o = new DataView(y.buffer), s = () => o.buffer === y.buffer ? o : o = new DataView(y.buffer);
				return s().setUint32(t, r, !0), i = A.napiValueFromJsValue(e.promise), n >>>= 0, s().setUint32(n, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function cr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t || !n) return r.setLastError(1);
				let e = A.isolate.getRef(t);
				return e.deref().resolve(A.jsValueFromNapiValue(n)), e.dispose(), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function lr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t || !n) return r.setLastError(1);
				let e = A.isolate.getRef(t);
				return e.deref().reject(A.jsValueFromNapiValue(n)), e.dispose(), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		function ur(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +(i instanceof Promise);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		var dr = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_create_promise: sr,
			napi_is_promise: ur,
			napi_reject_deferred: lr,
			napi_resolve_deferred: cr
		});
		function fr(e, t, n, r, i, a) {
			let o;
			if (!e) return 1;
			let s = M;
			if (s.checkGCAccess(), !s.lastException.isEmpty()) return s.setLastError(10);
			if (!s.canCallIntoJs()) return s.setLastError(s.moduleApiVersion >= 10 ? 23 : 10);
			s.clearLastError();
			try {
				if (!a || !t) return s.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let l = typeof e, u;
				try {
					u = l === "object" && e !== null || l === "function" ? e : Object(e);
				} catch {
					return s.setLastError(2);
				}
				if (n !== 0 && n !== 1 || i !== 0 && i !== 1) return s.setLastError(1);
				let d = [], f, p, m, h = !0, g = /^(0|[1-9][0-9]*)$/;
				do {
					for (f = Object.getOwnPropertyNames(u), p = Object.getOwnPropertySymbols(u), m = 0; m < f.length; m++) d.push({
						name: g.test(f[m]) ? Number(f[m]) : f[m],
						desc: Object.getOwnPropertyDescriptor(u, f[m]),
						own: h
					});
					for (m = 0; m < p.length; m++) d.push({
						name: p[m],
						desc: Object.getOwnPropertyDescriptor(u, p[m]),
						own: h
					});
					if (n === 1) break;
					u = Object.getPrototypeOf(u), h = !1;
				} while (u);
				let _ = [], v = function(e, t, n, r) {
					if (e.indexOf(t) === -1) {
						if (r === 0) e.push(t);
						else if (r === 1) {
							let r = typeof t == "number" ? String(t) : t;
							typeof r == "string" && n & 8 || e.push(r);
						}
					}
				};
				for (m = 0; m < d.length; m++) {
					let e = d[m], t = e.name, n = e.desc;
					if (r === 0) v(_, t, r, i);
					else {
						if (r & 8 && typeof t == "string" || r & 16 && typeof t == "symbol") continue;
						let e = !0;
						switch (r & 7) {
							case 1:
								e = !!n.writable;
								break;
							case 2:
								e = !!n.enumerable;
								break;
							case 3:
								e = !!(n.writable && n.enumerable);
								break;
							case 4:
								e = !!n.configurable;
								break;
							case 5:
								e = !!(n.configurable && n.writable);
								break;
							case 6:
								e = !!(n.configurable && n.enumerable);
								break;
							case 7: e = !!(n.configurable && n.enumerable && n.writable);
						}
						e && v(_, t, r, i);
					}
				}
				a >>>= 0, o = A.napiValueFromJsValue(_);
				var c = new DataView(y.buffer);
				return (c.buffer === y.buffer ? c : c = new DataView(y.buffer)).setUint32(a, o, !0), 0;
			} catch (e) {
				return s.lastException.resetTo(e), s.setLastError(10);
			}
		}
		function pr(e, t, n) {
			return fr(e, t, 0, 18, 1, n);
		}
		function mr(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!n || !r || !t) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t), a = typeof e;
				return a === "object" && e !== null || a === "function" ? (e[A.jsValueFromNapiValue(n)] = A.jsValueFromNapiValue(r), 0) : i.setLastError(2);
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function hr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!n || !r || !t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s = typeof e, c;
				try {
					c = s === "object" && e !== null || s === "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				r >>>= 0, i = +(A.jsValueFromNapiValue(n) in c);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function gr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!n || !r || !t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s = typeof e, c;
				try {
					c = s === "object" && e !== null || s === "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				r >>>= 0, i = A.napiValueFromJsValue(c[A.jsValueFromNapiValue(n)]);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function _r(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!n || !t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t), s = typeof e;
				if (!(s === "object" && e !== null || s === "function")) return a.setLastError(2);
				let c = A.jsValueFromNapiValue(n);
				if (A.features.Reflect) i = A.features.Reflect.deleteProperty(e, c);
				else try {
					i = delete e[c];
				} catch {
					i = !1;
				}
				if (r) {
					r >>>= 0;
					var o = new DataView(y.buffer);
					(o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, +!!i, !0);
				}
				return 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function vr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!n || !r || !t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s = typeof e, c;
				try {
					c = s === "object" && e !== null || s !== "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				let l = A.jsValueFromNapiValue(n);
				if (typeof l != "string" && typeof l != "symbol") return a.setLastError(4);
				i = Object.prototype.hasOwnProperty.call(c, A.jsValueFromNapiValue(n)), r >>>= 0;
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, +!!i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function yr(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!r || !t) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t), a = typeof e;
				return a === "object" && e !== null || a === "function" ? n ? (n >>>= 0, A.jsValueFromNapiValue(t)[z.UTF8ToString(n, -1)] = A.jsValueFromNapiValue(r), 0) : i.setLastError(1) : i.setLastError(2);
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function br(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!r || !t || !n) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s = typeof e, c;
				try {
					c = s === "object" && e !== null || s === "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				n >>>= 0, r >>>= 0, i = z.UTF8ToString(n, -1) in c;
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, +!!i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function xr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!r || !t || !n) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s = typeof e, c;
				try {
					c = s === "object" && e !== null || s === "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				n >>>= 0, r >>>= 0, i = A.napiValueFromJsValue(c[z.UTF8ToString(n, -1)]);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function Sr(e, t, n, r) {
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!r || !t) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t), a = typeof e;
				return a === "object" && e !== null || a === "function" ? (e[n >>> 0] = A.jsValueFromNapiValue(r), 0) : i.setLastError(2);
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function Cr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!r || !t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s, c = typeof e;
				try {
					s = c === "object" && e !== null || c === "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				r >>>= 0, i = +(n >>> 0 in s);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function wr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!r || !t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				let s = typeof e, c;
				try {
					c = s === "object" && e !== null || s === "function" ? e : Object(e);
				} catch {
					return a.setLastError(2);
				}
				r >>>= 0, i = A.napiValueFromJsValue(c[n >>> 0]);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function Tr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t), s = typeof e;
				if (!(s === "object" && e !== null || s === "function")) return a.setLastError(2);
				if (A.features.Reflect) i = A.features.Reflect.deleteProperty(e, n >>> 0);
				else try {
					i = delete e[n >>> 0];
				} catch {
					i = !1;
				}
				if (r) {
					r >>>= 0;
					var o = new DataView(y.buffer);
					(o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, +!!i, !0);
				}
				return 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function Er(e, t, n, r) {
			let i, a;
			if (!e) return 1;
			let o = M;
			if (o.checkGCAccess(), !o.lastException.isEmpty()) return o.setLastError(10);
			if (!o.canCallIntoJs()) return o.setLastError(o.moduleApiVersion >= 10 ? 23 : 10);
			o.clearLastError();
			try {
				if (r >>>= 0, n >>>= 0, n >>>= 0, n > 0 && !r || !t) return o.setLastError(1);
				let e = A.jsValueFromNapiValue(t), l = typeof e;
				if (!(l === "object" && e !== null || l === "function")) return o.setLastError(2);
				let u;
				var s = new DataView(y.buffer), c = () => s.buffer === y.buffer ? s : s = new DataView(y.buffer);
				for (let t = 0; t < n; t++) {
					i = r + t * 32;
					let n = c().getUint32(i, !0), s = c().getUint32(i + 4, !0), l = c().getUint32(i + 8, !0), d = c().getUint32(i + 12, !0), f = c().getUint32(i + 16, !0), p = c().getUint32(i + 20, !0);
					a = c().getInt32(i + 24, !0), a >>>= 0;
					let m = c().getUint32(i + 28, !0);
					if (n) u = z.UTF8ToString(n, -1);
					else if (!s || (u = A.jsValueFromNapiValue(s), typeof u != "string" && typeof u != "symbol")) return o.setLastError(4);
					xt(o, e, u, l, d, f, p, a, m);
				}
				return 0;
			} catch (e) {
				return o.lastException.resetTo(e), o.setLastError(10);
			}
		}
		function Dr(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !n.lastException.isEmpty()) return n.setLastError(10);
			if (!n.canCallIntoJs()) return n.setLastError(n.moduleApiVersion >= 10 ? 23 : 10);
			n.clearLastError();
			try {
				if (!t) return n.setLastError(1);
				let e = A.jsValueFromNapiValue(t), r = typeof e;
				return r === "object" && e !== null || r === "function" ? (Object.freeze(e), 0) : n.setLastError(2);
			} catch (e) {
				return n.lastException.resetTo(e), n.setLastError(10);
			}
		}
		function Or(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !n.lastException.isEmpty()) return n.setLastError(10);
			if (!n.canCallIntoJs()) return n.setLastError(n.moduleApiVersion >= 10 ? 23 : 10);
			n.clearLastError();
			try {
				if (!t) return n.setLastError(1);
				let e = A.jsValueFromNapiValue(t), r = typeof e;
				return r === "object" && e !== null || r === "function" ? (Object.seal(e), 0) : n.setLastError(2);
			} catch (e) {
				return n.lastException.resetTo(e), n.setLastError(10);
			}
		}
		var kr = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_define_properties: Er,
			napi_delete_element: Tr,
			napi_delete_property: _r,
			napi_get_all_property_names: fr,
			napi_get_element: wr,
			napi_get_named_property: xr,
			napi_get_property: gr,
			napi_get_property_names: pr,
			napi_has_element: Cr,
			napi_has_named_property: br,
			napi_has_own_property: vr,
			napi_has_property: hr,
			napi_object_freeze: Dr,
			napi_object_seal: Or,
			napi_set_element: Sr,
			napi_set_named_property: yr,
			napi_set_property: mr
		});
		function Ar(e, t, n) {
			let r, i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t || !n) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (typeof e != "string") return a.setLastError(3);
				let s = A.jsValueFromNapiValue(6).eval(e);
				n >>>= 0, i = A.napiValueFromJsValue(s);
				var o = new DataView(y.buffer);
				(o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setUint32(n, i, !0), r = 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
			return r;
		}
		var jr = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_run_script: Ar
		});
		function Mr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t), a = typeof i;
			n >>>= 0;
			let o;
			if (a === "number") o = 3;
			else if (a === "bigint") o = 9;
			else if (a === "string") o = 4;
			else if (a === "function") o = 7;
			else if (A.isExternal(i)) o = 8;
			else if (a === "object" && i !== null) o = 6;
			else if (a === "boolean") o = 2;
			else if (a === "undefined") o = 0;
			else if (a === "symbol") o = 5;
			else if (i === null) o = 1;
			else return r.setLastError(1);
			var s = new DataView(y.buffer);
			return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setInt32(n, o, !0), r.clearLastError();
		}
		function Nr(e, t, n) {
			let r;
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!t || !n) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				n >>>= 0, r = e ? 5 : 4;
				var a = new DataView(y.buffer);
				return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, r, !0), 0;
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function Pr(e, t, n) {
			let r;
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!t || !n) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (typeof e == "bigint") throw TypeError("Cannot convert a BigInt value to a number");
				n >>>= 0, r = A.napiValueFromJsValue(Number(e));
				var a = new DataView(y.buffer);
				return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, r, !0), 0;
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function Fr(e, t, n) {
			let r;
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!t || !n) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (e == null) throw TypeError("Cannot convert undefined or null to object");
				n >>>= 0, r = A.napiValueFromJsValue(Object(e));
				var a = new DataView(y.buffer);
				return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, r, !0), 0;
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function Ir(e, t, n) {
			let r;
			if (!e) return 1;
			let i = M;
			if (i.checkGCAccess(), !i.lastException.isEmpty()) return i.setLastError(10);
			if (!i.canCallIntoJs()) return i.setLastError(i.moduleApiVersion >= 10 ? 23 : 10);
			i.clearLastError();
			try {
				if (!t || !n) return i.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				if (typeof e == "symbol") throw TypeError("Cannot convert a Symbol value to a string");
				n >>>= 0, r = A.napiValueFromJsValue(String(e));
				var a = new DataView(y.buffer);
				return (a.buffer === y.buffer ? a : a = new DataView(y.buffer)).setUint32(n, r, !0), 0;
			} catch (e) {
				return i.lastException.resetTo(e), i.setLastError(10);
			}
		}
		function Lr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t || !r || !n) return a.setLastError(1);
				r >>>= 0;
				var o = new DataView(y.buffer), s = () => o.buffer === y.buffer ? o : o = new DataView(y.buffer);
				s().setInt8(r, 0, !0);
				let e = A.jsValueFromNapiValue(n);
				return typeof e == "function" ? (i = +(A.jsValueFromNapiValue(t) instanceof e), s().setInt8(r, i, !0), 0) : a.setLastError(5);
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function Rr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +!!Array.isArray(i);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function zr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +(i instanceof ArrayBuffer);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Br(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +(typeof SharedArrayBuffer == "function" && i instanceof SharedArrayBuffer || Object.prototype.toString.call(i) === "[object SharedArrayBuffer]");
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Vr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +(i instanceof Date);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Hr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +(i instanceof Error);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Ur(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = ArrayBuffer.isView(i) && !(i instanceof DataView) ? 1 : 0;
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Wr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = A.features.Buffer, o = ArrayBuffer.isView(i) || typeof a == "function" && a.isBuffer(i) ? 1 : 0;
			var s = new DataView(y.buffer);
			return (s.buffer === y.buffer ? s : s = new DataView(y.buffer)).setInt8(n, o, !0), r.clearLastError();
		}
		function Gr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !t || !n) return r.setLastError(1);
			let i = A.jsValueFromNapiValue(t);
			n >>>= 0;
			let a = +(i instanceof DataView);
			var o = new DataView(y.buffer);
			return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(n, a, !0), r.clearLastError();
		}
		function Kr(e, t, n, r) {
			let i;
			if (!e) return 1;
			let a = M;
			if (a.checkGCAccess(), !a.lastException.isEmpty()) return a.setLastError(10);
			if (!a.canCallIntoJs()) return a.setLastError(a.moduleApiVersion >= 10 ? 23 : 10);
			a.clearLastError();
			try {
				if (!t || !n || !r) return a.setLastError(1);
				let e = A.jsValueFromNapiValue(t), s = A.jsValueFromNapiValue(n);
				r >>>= 0, i = +(e === s);
				var o = new DataView(y.buffer);
				return (o.buffer === y.buffer ? o : o = new DataView(y.buffer)).setInt8(r, i, !0), 0;
			} catch (e) {
				return a.lastException.resetTo(e), a.setLastError(10);
			}
		}
		function qr(e, t) {
			if (!e) return 1;
			let n = M;
			if (n.checkGCAccess(), !t) return n.setLastError(1);
			let r = A.jsValueFromNapiValue(t);
			if (!(r instanceof ArrayBuffer)) return typeof SharedArrayBuffer == "function" && r instanceof SharedArrayBuffer ? n.setLastError(20) : n.setLastError(19);
			try {
				let e = A.features.MessageChannel;
				new e().port1.postMessage(r, [r]);
			} catch {
				return n.setLastError(9);
			}
			return n.clearLastError();
		}
		function Jr(e, t, n) {
			if (!e) return 1;
			let r = M;
			if (r.checkGCAccess(), !r.lastException.isEmpty()) return r.setLastError(10);
			if (!r.canCallIntoJs()) return r.setLastError(r.moduleApiVersion >= 10 ? 23 : 10);
			r.clearLastError();
			try {
				if (!t || !n) return r.setLastError(1);
				let e = A.jsValueFromNapiValue(t);
				n >>>= 0;
				var i = new DataView(y.buffer), a = () => i.buffer === y.buffer ? i : i = new DataView(y.buffer);
				if (e instanceof ArrayBuffer && e.byteLength === 0) try {
					new Uint8Array(e);
				} catch {
					return a().setInt8(n, 1, !0), 0;
				}
				return a().setInt8(n, 0, !0), 0;
			} catch (e) {
				return r.lastException.resetTo(e), r.setLastError(10);
			}
		}
		var Yr = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_coerce_to_bool: Nr,
			napi_coerce_to_number: Pr,
			napi_coerce_to_object: Fr,
			napi_coerce_to_string: Ir,
			napi_detach_arraybuffer: qr,
			napi_instanceof: Lr,
			napi_is_array: Rr,
			napi_is_arraybuffer: zr,
			napi_is_buffer: Wr,
			napi_is_dataview: Gr,
			napi_is_date: Vr,
			napi_is_detached_arraybuffer: Jr,
			napi_is_error: Hr,
			napi_is_typedarray: Ur,
			napi_strict_equals: Kr,
			napi_typeof: Mr,
			node_api_is_sharedarraybuffer: Br
		});
		function Xr(e, t) {
			if (!e) return 1;
			let n = M;
			if (!t) return n.setLastError(1);
			var r = new DataView(y.buffer);
			return (r.buffer === y.buffer ? r : r = new DataView(y.buffer)).setUint32(t, 10, !0), n.clearLastError();
		}
		var Zr = /*#__PURE__*/ Object.freeze({
			__proto__: null,
			napi_get_version: Xr
		});
		L.init(), R.init(), z.init(), ce.init(), k.emnapi.syncMemory = Rt, k.emnapi.getMemoryAddress = Bt, k.emnapi.acquireExternalSharedArrayBuffer = Gt;
		function $(e) {
			let t = Object.keys(e);
			for (let n = 0; n < t.length; ++n) {
				let r = t[n];
				r.indexOf("$") !== 0 && (r.indexOf("emnapi_") === 0 ? k.imports.emnapi[r] = e[r] : r.indexOf("_emnapi_") === 0 || r.indexOf("_v8_") === 0 || r === "napi_set_last_error" || r === "napi_clear_last_error" ? k.imports.env[r] = e[r] : k.imports.napi[r] = e[r]);
			}
		}
		$(Ie), $(Re), $(De), $(it), $(yt), $(un), $(hn), $(Nt), $(vn), $(Kt), $(J), $(Fn), $(Jn), $(Xn), $(or), $(dr), $(kr), $(jr), $(Yr), $(Zr);
		let Qr = {
			emnapiString: z,
			emnapiExternalMemory: L
		};
		return Object.keys(le).forEach((e) => {
			Object.defineProperty(Qr, e, {
				get: () => le[e],
				enumerable: !0,
				configurable: !0
			});
		}), Object.keys(or).forEach((e) => {
			Object.defineProperty(Qr, e, {
				get: () => or[e],
				enumerable: !0,
				configurable: !0
			});
		}), Object.keys(De).forEach((e) => {
			Object.defineProperty(Qr, e, {
				get: () => De[e],
				enumerable: !0,
				configurable: !0
			});
		}), k.plugins = (e.plugins ?? []).map((e) => {
			if (typeof e == "function") return e(Qr);
			if (typeof e == "object" && e) return e;
			throw TypeError("Invalid plugin");
		}), k.plugins.forEach((e) => {
			if (typeof e.importObject == "function") {
				let t = e.importObject(k.imports);
				t && (k.imports = t);
			}
		}), k;
	})();
}
var ie = re;
function P(e, t, n, r, i = !1) {
	r ??= {};
	let a = r.getMemory, o = r.getTable, s = r.beforeInit;
	if (a != null && typeof a != "function") throw TypeError("options.getMemory is not a function");
	if (o != null && typeof o != "function") throw TypeError("options.getTable is not a function");
	if (s != null && typeof s != "function") throw TypeError("options.beforeInit is not a function");
	let c, l = typeof t == "object" && !!t;
	if (l) {
		if (t.loaded) throw Error(`${i ? "napiModule" : "addonModule"} has already loaded`);
		c = t;
	} else c = re(r);
	let u = r.wasi, d, f = {
		env: c.imports.env,
		napi: c.imports.napi,
		emnapi: c.imports.emnapi
	};
	u && (d = new E(c.childThread ? {
		wasi: u,
		childThread: !0,
		postMessage: c.postMessage
	} : {
		wasi: u,
		threadManager: c.PThread,
		waitThreadStart: c.waitThreadStart
	}), Object.assign(f, typeof u.getImportObject == "function" ? u.getImportObject() : { wasi_snapshot_preview1: u.wasiImport }), Object.assign(f, d.getImportObject()));
	let p = r.overwriteImports;
	if (typeof p == "function") {
		let e = p(f);
		typeof e == "object" && e && (f = e);
	}
	return e(n, f, (t, n) => {
		if (t) throw t;
		let r = n.instance, p = r, m = r.exports, h = "memory" in m, g = "memory" in f.env, _ = a ? a(m) : h ? m.memory : g ? f.env.memory : void 0;
		if (!_) throw Error("memory is neither exported nor imported");
		let v = o ? o(m) : m.__indirect_function_table;
		if (u && !h) {
			let e = Object.create(null);
			Object.assign(e, m, { memory: _ }), p = { exports: e };
		}
		let y = n.module;
		u ? p = d.initialize(p, y, _) : c.PThread.setup(y, _);
		let b = () => {
			s && s({
				instance: r,
				module: y
			}), c.init({
				instance: p,
				module: y,
				memory: _,
				table: v
			});
			let e = {
				instance: r,
				module: y,
				usedInstance: p
			};
			return l || (i ? e.napiModule = c : e.addonModule = c), e;
		};
		if (c.PThread.shouldPreloadWorkers()) {
			if (e === ae) return c.PThread.loadWasmModuleToAllWorkers().then(b);
			let t = c.PThread, n = t.unusedWorkers.slice();
			for (let e = 0; e < n.length; ++e) {
				let r = n[e];
				r.whenLoaded || t.loadWasmModuleToWorker(r).then(void 0, () => {});
			}
		}
		return b();
	});
}
function ae(e, t, n) {
	return N(e, t).then((e) => n(null, e), (e) => n(e));
}
function oe(e, t, n) {
	let r;
	try {
		r = ne(e, t);
	} catch (e) {
		return n(e);
	}
	return n(null, r);
}
function se(e, t, n) {
	if (typeof e != "object" || !e) throw TypeError("Invalid addonModule");
	return P(ae, e, t, n);
}
function ce(e, t, n) {
	if (typeof e != "object" || !e) throw TypeError("Invalid addonModule");
	return P(oe, e, t, n);
}
function le(e, t, n) {
	if (typeof e != "object" || !e) throw TypeError("Invalid napiModule");
	return P(ae, e, t, n, !0);
}
function ue(e, t, n) {
	if (typeof e != "object" || !e) throw TypeError("Invalid napiModule");
	return P(oe, e, t, n, !0);
}
function de(e, t) {
	return P(ae, void 0, e, t);
}
function fe(e, t) {
	return P(oe, void 0, e, t);
}
function pe(e, t) {
	return P(ae, void 0, e, t, !0);
}
function me(e, t) {
	return P(oe, void 0, e, t, !0);
}
var he = class extends te {
	constructor(e) {
		if (typeof e.onLoad != "function") throw TypeError("options.onLoad is not a function");
		let t = e.onError;
		super({
			...e,
			onError: (e, n) => {
				if (typeof t == "function") t(e, n);
				else throw e;
			}
		}), this.addonModule = void 0, this.napiModule = void 0;
	}
	beforeReportError(e, t) {
		let n = this.instance?.exports.emnapi_thread_crashed;
		typeof n == "function" && n();
	}
	instantiate(e) {
		let t = this.onLoad(e);
		return typeof t.then == "function" ? t.then((e) => (this.setAddonModule(e), e)) : (this.setAddonModule(t), t);
	}
	setAddonModule(e) {
		let t = "addonModule" in e ? e.addonModule : e.napiModule;
		this.addonModule = t, this.napiModule = t;
	}
	handle(e) {
		if (super.handle(e), e?.data?.__emnapi__) {
			let t = e.data.__emnapi__.type, n = e.data.__emnapi__.payload;
			try {
				t === "async-worker-init" && this.handleAfterLoad(e, () => {
					this.addonModule.initWorker(n.arg, n.func);
				});
			} catch (e) {
				this.reportError(e, "async-worker-init");
			}
		}
	}
}, ge = "2.0.0-beta.2", _e = /* @__PURE__ */ t({
	ArrayStore: () => Me,
	BaseArrayStore: () => je,
	Context: () => St,
	CountIdAllocator: () => ke,
	CountIdReuseAllocator: () => Ae,
	Disposable: () => F,
	EmnapiError: () => L,
	Env: () => Le,
	External: () => qe,
	Finalizer: () => De,
	FunctionTemplate: () => ot,
	HandleScope: () => Ye,
	HandleStore: () => We,
	Isolate: () => gt,
	NAPI_VERSION_EXPERIMENTAL: () => we,
	NODE_API_DEFAULT_MODULE_API_VERSION: () => 8,
	NODE_API_SUPPORTED_VERSION_MAX: () => 10,
	NODE_API_SUPPORTED_VERSION_MIN: () => 1,
	NodeEnv: () => Re,
	NotSupportBufferError: () => z,
	NotSupportWeakRefError: () => R,
	ObjectTemplate: () => it,
	Persistent: () => Fe,
	PersistentStore: () => Ne,
	Private: () => V,
	RefTracker: () => Ee,
	Reference: () => Ve,
	ReferenceOwnership: () => ze,
	ReferenceWithData: () => He,
	ReferenceWithFinalizer: () => Ue,
	ScopeStore: () => Xe,
	Signature: () => at,
	StrongRef: () => I,
	Template: () => Qe,
	TrackedFinalizer: () => Oe,
	TryCatch: () => B,
	createContext: () => wt,
	deletePrivate: () => ft,
	getDefaultContext: () => Tt,
	getDylinkMetadata: () => Se,
	getExternalValue: () => Je,
	getInternalField: () => nt,
	getPrivate: () => ut,
	hasPrivate: () => dt,
	isExternal: () => Ke,
	isReferenceType: () => xe,
	setInternalField: () => rt,
	setPrivate: () => lt,
	version: () => Ce
});
function ve() {
	return typeof FinalizationRegistry < "u" && typeof WeakRef < "u";
}
var ye = ve();
function be(e) {
	let t = (function() {
		let e;
		try {
			e = Function();
		} catch {
			return !1;
		}
		return typeof e == "function";
	})(), r = (function() {
		try {
			return !!Object.getOwnPropertyDescriptor(Function.prototype, "name")?.configurable;
		} catch {
			return !1;
		}
	})(), i = (function() {
		try {
			let e = Symbol();
			new WeakRef(e), (/* @__PURE__ */ new WeakMap()).set(e, void 0);
		} catch {
			return !1;
		}
		return !0;
	})(), a = (function() {
		let e;
		return e = typeof __webpack_public_path__ < "u" ? (function() {
			return typeof __non_webpack_require__ < "u" ? __non_webpack_require__ : void 0;
		})() : (function() {
			return typeof __webpack_public_path__ < "u" ? typeof __non_webpack_require__ < "u" ? __non_webpack_require__ : void 0 : n === void 0 ? void 0 : n;
		})(), e;
	})();
	function o() {
		if (typeof globalThis < "u") return globalThis;
		let e = (function() {
			return this;
		})();
		if (!e && t) try {
			e = Function("return this")();
		} catch {}
		if (!e) {
			if (typeof __webpack_public_path__ > "u" && typeof global < "u") return global;
			if (typeof window < "u") return window;
			if (typeof self < "u") return self;
		}
		throw Error("Unable to get globalThis");
	}
	function s() {
		let e, t;
		return {
			promise: new this((n, r) => {
				e = n, t = r;
			}),
			resolve: e,
			reject: t
		};
	}
	let c = e && "getGlobalThis" in e ? e.getGlobalThis ?? o : o, l = e && "withResolvers" in e ? e.withResolvers ?? s : typeof Promise.withResolvers == "function" ? Promise.withResolvers : s, u = c?.().process?.getBuiltinModule ?? a, d = {
		makeDynamicFunction: t ? (...e) => Function(...e) : void 0,
		setFunctionName: r ? (e, t) => {
			Object.defineProperty(e, "name", { value: t });
		} : void 0,
		Reflect: typeof Reflect == "object" ? Reflect : void 0,
		finalizer: ve(),
		weakSymbol: i,
		BigInt: typeof BigInt < "u" ? BigInt : void 0,
		MessageChannel: typeof MessageChannel == "function" ? MessageChannel : (function() {
			try {
				return u("worker_threads").MessageChannel;
			} catch {}
		})(),
		setImmediate: typeof setImmediate == "function" ? setImmediate.bind(c()) : function(e) {
			if (typeof e != "function") throw TypeError("The \"callback\" argument must be of type function");
			if (d.MessageChannel) {
				let t = new d.MessageChannel();
				t.port1.onmessage = function() {
					t.port1.onmessage = null, t = void 0, e();
				}, t.port2.postMessage(null);
			} else setTimeout(e, 0);
		},
		Buffer: typeof Buffer == "function" ? Buffer : (function() {
			try {
				return u("buffer").Buffer;
			} catch {}
		})(),
		...e,
		getGlobalThis: c,
		withResolvers: l
	};
	return d;
}
function xe(e) {
	return typeof e == "object" && !!e || typeof e == "function";
}
function Se(e) {
	let t = 0, n = 0, r = new TextDecoder();
	function i() {
		return e[t++];
	}
	function a() {
		let n = 0, r = 1;
		for (;;) {
			let i = e[t++];
			if (n += (i & 127) * r, r *= 128, !(i & 128)) break;
		}
		return n;
	}
	function o() {
		let n = a();
		return t += n, r.decode(e.subarray(t - n, t));
	}
	function s() {
		let e = a(), t = [];
		for (; e--;) t.push(o());
		return t;
	}
	function c(e, t) {
		if (e) throw Error(t);
	}
	if (e instanceof WebAssembly.Module) {
		let t = WebAssembly.Module.customSections(e, "dylink.0");
		c(t.length === 0, "need dylink section"), e = new Uint8Array(t[0]), n = e.length;
	} else {
		var l = new Uint32Array(new Uint8Array(e.subarray(0, 24)).buffer);
		c(l[0] !== 1836278016 && l[0] !== 6386541, "need to see wasm magic number"), c(e[8] !== 0, "need the dylink section to be first"), t = 9;
		var u = a();
		n = t + u, c(o() !== "dylink.0");
	}
	for (var d = {
		neededDynlibs: [],
		tlsExports: /* @__PURE__ */ new Set(),
		weakImports: /* @__PURE__ */ new Set(),
		runtimePaths: [],
		memorySize: 0,
		memoryAlign: 0,
		tableSize: 0,
		tableAlign: 0
	}, f = 1, p = 2, m = 3, h = 4, g = 5, _ = 256, v = 3, y = 1; t < n;) {
		var b = i(), x = a();
		if (b === f) d.memorySize = a(), d.memoryAlign = a(), d.tableSize = a(), d.tableAlign = a();
		else if (b === p) d.neededDynlibs = s();
		else if (b === m) {
			let e = a();
			for (; e--;) {
				let e = o();
				a() & _ && d.tlsExports.add(e);
			}
		} else if (b === h) {
			let e = a();
			for (; e--;) {
				o();
				let e = o();
				(a() & v) === y && d.weakImports.add(e);
			}
		} else b === g ? d.runtimePaths = s() : (console.error("unknown dylink.0 subsection:", b), t += x);
	}
	var S = 2 ** d.tableAlign;
	return c(S !== 1, `invalid tableAlign ${S}`), c(t !== n), d;
}
var Ce = "2.0.0-beta.2", we = 2147483647, Te = 137, F = class {};
typeof Symbol.dispose == "symbol" && Object.defineProperty(F.prototype, Symbol.dispose, {
	value() {
		this.dispose();
	},
	writable: !0,
	enumerable: !1,
	configurable: !0
});
var Ee = class extends F {
	constructor() {
		super(...arguments), this._next = null, this._prev = null;
	}
	dispose() {}
	finalize() {}
	link(e) {
		this._prev = e, this._next = e._next, this._next !== null && (this._next._prev = this), e._next = this;
	}
	unlink() {
		this._prev !== null && (this._prev._next = this._next), this._next !== null && (this._next._prev = this._prev), this._prev = null, this._next = null;
	}
	static finalizeAll(e) {
		for (; e._next !== null;) e._next.finalize();
	}
}, De = class e {
	constructor(e, t = 0, n = 0, r = 0) {
		this.envObject = e, this._finalizeCallback = t, this._finalizeData = n, this._finalizeHint = r, this._makeDynCall_vppp = e.bridge.makeDynCall_vppp;
	}
	copy() {
		let t = Object.create(e.prototype);
		return t.envObject = this.envObject, t._makeDynCall_vppp = this._makeDynCall_vppp, t._finalizeCallback = this._finalizeCallback, t._finalizeData = this._finalizeData, t._finalizeHint = this._finalizeHint, t;
	}
	move(e) {
		e._finalizeCallback = this._finalizeCallback, e._finalizeData = this._finalizeData, e._finalizeHint = this._finalizeHint, e.envObject = this.envObject, e._makeDynCall_vppp = this._makeDynCall_vppp, this._finalizeCallback = 0, this._finalizeData = 0, this._finalizeHint = 0, this.dispose();
	}
	callback() {
		return this._finalizeCallback;
	}
	data() {
		return this._finalizeData;
	}
	hint() {
		return this._finalizeHint;
	}
	resetEnv() {
		this.envObject = void 0;
	}
	resetFinalizer() {
		this._finalizeCallback = 0, this._finalizeData = 0, this._finalizeHint = 0;
	}
	callFinalizer() {
		let e = this._finalizeCallback, t = this._finalizeData, n = this._finalizeHint;
		if (this.resetFinalizer(), !e) return;
		let r = Number(e);
		this.envObject ? this.envObject.callFinalizer(r, t, n) : this._makeDynCall_vppp(r)(0, t, n);
	}
	dispose() {
		this.envObject = void 0, this._makeDynCall_vppp = void 0;
	}
}, Oe = class e extends Ee {
	static create(t, n, r, i) {
		let a = new e(t, n, r, i);
		return a.link(t.finalizing_reflist), a;
	}
	constructor(e, t, n, r) {
		super(), this._finalizer = new De(e, t, n, r);
	}
	data() {
		return this._finalizer.data();
	}
	dispose() {
		this._finalizer && (this.unlink(), this._finalizer.envObject.dequeueFinalizer(this), this._finalizer.dispose(), this._finalizer = void 0, super.dispose());
	}
	finalize() {
		this.unlink();
		let e, t = !1;
		try {
			this._finalizer.callFinalizer();
		} catch (n) {
			t = !0, e = n;
		}
		if (this.dispose(), t) throw e;
	}
}, ke = class extends F {
	constructor(e = 1) {
		super(), this.next = e;
	}
	aquire() {
		return this.next++;
	}
	release(e) {}
	dispose() {}
}, Ae = class extends ke {
	constructor() {
		super(...arguments), this._freeList = [], this._freeListHead = 0;
	}
	aquire() {
		if (this._freeListHead < this._freeList.length) {
			let e = this._freeList[this._freeListHead++];
			return this._freeListHead === this._freeList.length && (this._freeList.length = 0, this._freeListHead = 0), e;
		}
		return super.aquire();
	}
	release(e) {
		this._freeList.push(e);
	}
	dispose() {
		this._freeList.length = 0, this._freeListHead = 0, super.dispose();
	}
}, je = class extends F {
	constructor(e = 1) {
		super(), this._values = [void 0];
		for (let t = 1; t < e; t++) this._values.push(void 0);
	}
	assign(e, t) {
		return this._values[e] = t, t;
	}
	deref(e) {
		return this._values[e];
	}
	alloc(e, ...t) {
		return e(...t);
	}
	dealloc(e) {
		this._values[e] = void 0;
	}
	dispose() {
		this._values.forEach((e, t) => this.dealloc(t));
	}
}, Me = class extends je {
	constructor(e = 4) {
		super(e), this._allocator = new Ae(1);
	}
	insert(e) {
		let t = this._allocator.aquire();
		e.id = t, this._values[t] = e;
	}
	alloc(e, ...t) {
		let n = e(...t);
		return this.insert(n), n;
	}
	dealloc(e) {
		this._allocator.release(e), super.dealloc(e);
	}
}, Ne = class extends Me {
	constructor(e = 4) {
		super(e), this._recyleList = [], this._recyleListHead = 0;
	}
	markUnused(e) {
		this._recyleList.push(e);
	}
	recycle() {
		for (; this._recyleListHead < this._recyleList.length;) {
			let e = this._recyleList[this._recyleListHead++];
			this._recyleListHead === this._recyleList.length && (this._recyleList.length = 0, this._recyleListHead = 0), this.deref(e).dispose();
		}
	}
}, Pe = class {
	constructor(e) {
		this._objects = /* @__PURE__ */ new WeakMap(), this._primitives = /* @__PURE__ */ new Map(), this._bySlot = /* @__PURE__ */ new Map(), this._isolate = e;
	}
	acquire(e) {
		let t = e !== null && (typeof e == "object" || typeof e == "function"), n = t ? this._objects : this._primitives, r = n.get(e);
		if (r?.retired && (r = void 0), !r) {
			let i = new Fe(this._isolate, e);
			t && i.setWeak(void 0, () => {}), r = {
				reference: i,
				count: 0,
				pending: !1,
				retired: !1,
				objectLike: t,
				primitiveValue: t ? void 0 : e
			}, n.set(e, r), this._bySlot.set(i.slot(), r);
		}
		return r.count++, r.pending = !1, r.reference.slot();
	}
	retain(e) {
		let t = this._bySlot.get(Number(e));
		t && !t.retired && (t.count++, t.pending = !1);
	}
	release(e) {
		let t = this._bySlot.get(Number(e));
		t && !t.retired && t.count !== 0 && (--t.count !== 0 || t.pending || (t.pending = !0, Promise.resolve().then(() => {
			t.pending = !1, !(t.count !== 0 || t.retired) && (t.retired = !0, this._bySlot.delete(t.reference.slot()), t.objectLike || this._primitives.delete(t.primitiveValue), t.reference.dispose());
		})));
	}
}, I = class extends F {
	constructor(e) {
		super(), this._value = e;
	}
	deref() {
		return this._value;
	}
	dispose() {
		this._value = void 0;
	}
}, Fe = class e extends F {
	constructor(e, ...t) {
		super(), this.id = 0, this._isolate = e, e.insertRef(this), this._slotId = 2147483648 + this.id, this.setSlot(t.length === 0 ? void 0 : new I(t[0]));
	}
	dispose() {
		this.reset(), this.deleteSlot(), this._isolate.globalHandleStore.dealloc(this.id), this._isolate = void 0, this.id = 0;
	}
	copy() {
		let t = new e(this._isolate);
		t._param = this._param, t._callback = this._callback;
		let n = this.getSlot();
		if (n instanceof I) t.setSlot(new I(n.deref()));
		else if (n instanceof WeakRef) {
			let e = n.deref();
			e === void 0 ? t.setSlot(void 0) : (t.setSlot(new I(e)), t.setWeak(this._param, this._callback));
		} else t.setSlot(void 0);
		return t;
	}
	move(e) {
		this !== e && (e.reset(), e._param = this._param, e._callback = this._callback, e._isolate = this._isolate, e.setSlot(this.getSlot()), this.reset(), this.setSlot(void 0));
	}
	slot() {
		return this._slotId;
	}
	getSlot() {
		return this._isolate.getRefSlotValue(this.slot());
	}
	setSlot(e) {
		this._isolate.setRefSlotValue(this.slot(), e);
	}
	deleteSlot() {
		this._isolate.deleteRefSlotValue(this.slot());
	}
	setWeak(t, n) {
		let r = this.getSlot();
		if (!ye || r === void 0 || r instanceof WeakRef) return;
		let i = r.deref();
		try {
			e._registry.register(i, this, this);
			let a = new WeakRef(i);
			r.dispose(), this.setSlot(a), this._param = t, this._callback = n;
		} catch (e) {
			if (typeof i != "symbol") throw e;
		}
	}
	clearWeak() {
		let t = this.getSlot();
		if (ye && t !== void 0 && t instanceof WeakRef) {
			try {
				e._registry.unregister(this);
			} catch {}
			this._param = void 0, this._callback = void 0;
			let n = t.deref();
			n === void 0 ? this.setSlot(n) : this.setSlot(new I(n));
		}
	}
	reset() {
		if (ye) try {
			e._registry.unregister(this);
		} catch {}
		this._param = void 0, this._callback = void 0;
		let t = this.getSlot();
		t instanceof I && t.dispose(), this.setSlot(void 0);
	}
	resetTo(e) {
		this.reset(), this.setSlot(new I(e));
	}
	isEmpty() {
		return this.getSlot() === void 0;
	}
	deref() {
		let e = this.getSlot();
		if (e !== void 0) return e.deref();
	}
};
Fe._registry = ye ? new FinalizationRegistry((e) => {
	e.setSlot(void 0);
	let t = e._callback, n = e._param;
	e._callback = void 0, e._param = void 0, typeof t == "function" && t(n);
}) : void 0;
function Ie(e, t) {
	if (!e.terminatedOrTerminating()) throw t;
}
var Le = class extends F {
	constructor(e, t, n) {
		super(), this.openHandleScopes = 0, this.instanceData = null, this.refs = 1, this.reflist = new Ee(), this.finalizing_reflist = new Ee(), this.pendingFinalizers = /* @__PURE__ */ new Set(), this.inGcFinalizer = !1, this._bindingMap = /* @__PURE__ */ new WeakMap(), this.ctx = e, this.store = t, this.id = 0, this.store.insert(this), this.lastException = new Fe(e.isolate), this.bridge = n, this.address = typeof n.address == "function" ? n.address() : n.address;
	}
	canCallIntoJs() {
		return !0;
	}
	terminatedOrTerminating() {
		return !this.canCallIntoJs();
	}
	ref() {
		this.refs++;
	}
	unref() {
		this.refs--, this.refs === 0 && this.dispose();
	}
	clearLastError() {
		return this.bridge.setLastError(this.address, 0, 0, 0), 0;
	}
	setLastError(e, t = 0, n = 0) {
		return this.bridge.setLastError(this.address, e, t, n), e;
	}
	callIntoModule(e, t = Ie) {
		let n = this.openHandleScopes;
		this.clearLastError();
		let r = e(this);
		if (n !== this.openHandleScopes && this.bridge.abort("open_handle_scopes != open_handle_scopes_before"), !this.lastException.isEmpty()) {
			let e = this.lastException.deref();
			this.lastException.reset(), t(this, e);
		}
		return r;
	}
	invokeFinalizerFromGC(e) {
		if (this.moduleApiVersion !== 2147483647) this.enqueueFinalizer(e);
		else {
			let t = this.inGcFinalizer;
			this.inGcFinalizer = !0;
			try {
				e.finalize();
			} finally {
				this.inGcFinalizer = t;
			}
		}
	}
	checkGCAccess() {
		this.moduleApiVersion === 2147483647 && this.inGcFinalizer && this.bridge.abort("Finalizer is calling a function that may affect GC state.\nThe finalizers are run directly from GC and must not affect GC state.\nUse `node_api_post_finalizer` from inside of the finalizer to work around this issue.\nIt schedules the call as a new task in the event loop.");
	}
	enqueueFinalizer(e) {
		this.pendingFinalizers.add(e);
	}
	dequeueFinalizer(e) {
		this.pendingFinalizers.delete(e);
	}
	deleteMe() {
		Ee.finalizeAll(this.finalizing_reflist), Ee.finalizeAll(this.reflist), this.lastException.reset(), this.store.dealloc(this.id), this.bridge.deleteEnv(this.address);
	}
	dispose() {
		this.id !== 0 && (this.deleteMe(), this.finalizing_reflist.dispose(), this.reflist.dispose(), this.id = 0);
	}
	initObjectBinding(e) {
		let t = {
			wrapped: 0,
			tag: null
		};
		return this._bindingMap.set(e, t), t;
	}
	getObjectBinding(e) {
		return this._bindingMap.has(e) ? this._bindingMap.get(e) : this.initObjectBinding(e);
	}
	setInstanceData(e, t, n) {
		this.instanceData && this.instanceData.dispose(), this.instanceData = Oe.create(this, t, e, n);
	}
	getInstanceData() {
		return this.instanceData ? this.instanceData.data() : 0;
	}
}, Re = class extends Le {
	constructor(e, t, n) {
		super(e, t, n), this.destructing = !1, this.finalizationScheduled = !1, this.bridge = n;
	}
	deleteMe() {
		this.destructing = !0, this.drainFinalizerQueue(), super.deleteMe();
	}
	canCallIntoJs() {
		return super.canCallIntoJs() && this.ctx.canCallIntoJs();
	}
	triggerFatalException(e) {
		if (this.nodeBinding) this.nodeBinding.napi.fatalException(e);
		else if (typeof process == "object" && process !== null && typeof process._fatalException == "function") process._fatalException(e) || (console.error(e), process.exit(1));
		else throw e;
	}
	callbackIntoModule(e, t) {
		return this.callIntoModule(t, (t, n) => {
			if (t.terminatedOrTerminating()) return;
			let r = typeof process == "object" && process !== null, i = r ? !!(process.execArgv && process.execArgv.indexOf("--force-node-api-uncaught-exceptions-policy") !== -1) : !1;
			t.moduleApiVersion < 10 && !i && !e ? (r && typeof process.emitWarning == "function" ? process.emitWarning : function(e, t, n) {
				if (e instanceof Error) console.warn(e.toString());
				else {
					let r = n ? `[${n}] ` : "";
					console.warn(`${r}${t || "Warning"}: ${e}`);
				}
			})("Uncaught Node-API callback exception detected, please run node with option --force-node-api-uncaught-exceptions-policy=true to handle those exceptions properly.", "DeprecationWarning", "DEP0168") : t.triggerFatalException(n);
		});
	}
	callFinalizer(e, t, n) {
		this.callFinalizerInternal(1, e, t, n);
	}
	callFinalizerInternal(e, t, n, r) {
		let i = this.bridge.makeDynCall_vppp(t), a = this.address, o = this.ctx.openScope(this);
		try {
			this.callbackIntoModule(!!e, () => {
				i(a, n, r);
			});
		} finally {
			this.ctx.closeScope(this, o);
		}
	}
	enqueueFinalizer(e) {
		super.enqueueFinalizer(e), !this.finalizationScheduled && !this.destructing && (this.finalizationScheduled = !0, this.ref(), this.ctx.features.setImmediate(() => {
			this.finalizationScheduled = !1, this.unref(), this.drainFinalizerQueue();
		}));
	}
	drainFinalizerQueue() {
		for (let e of this.pendingFinalizers) this.pendingFinalizers.delete(e), e.finalize();
	}
}, L = class e extends Error {
	constructor(t) {
		super(t);
		let n = new.target, r = n.prototype;
		if (!(this instanceof e)) {
			let e = Object.setPrototypeOf;
			typeof e == "function" ? e.call(Object, this, r) : this.__proto__ = r, typeof Error.captureStackTrace == "function" && Error.captureStackTrace(this, n);
		}
	}
};
Object.defineProperty(L.prototype, "name", {
	configurable: !0,
	writable: !0,
	value: "EmnapiError"
});
var R = class extends L {
	constructor(e, t) {
		super(`${e}: The current runtime does not support "FinalizationRegistry" and "WeakRef".${t ? ` ${t}` : ""}`);
	}
};
Object.defineProperty(R.prototype, "name", {
	configurable: !0,
	writable: !0,
	value: "NotSupportWeakRefError"
});
var z = class extends L {
	constructor(e, t) {
		super(`${e}: The current runtime does not support "Buffer". Consider using buffer polyfill to make sure \`globalThis.Buffer\` is defined.${t ? ` ${t}` : ""}`);
	}
};
Object.defineProperty(z.prototype, "name", {
	configurable: !0,
	writable: !0,
	value: "NotSupportBufferError"
});
var ze;
(function(e) {
	e[e.kRuntime = 0] = "kRuntime", e[e.kUserland = 1] = "kUserland";
})(ze ||= {});
function Be(e) {
	if (!e) return !1;
	let t = typeof e;
	return t === "object" || t === "function" || t === "symbol";
}
var Ve = class e extends Ee {
	static weakCallback(e) {
		e.getPersistent().reset(), e.invokeFinalizerFromGC();
	}
	static create(t, n, r, i, a, o, s, c) {
		let l = new e(t, n, r, i, a);
		return n && l.link(n.reflist), l;
	}
	constructor(e, t, n, r, i) {
		super(), this.envObject = t, this._refcount = r, this._ownership = i;
		let a = t ? t.ctx.jsValueFromNapiValue(n) : n;
		this.canBeWeak = Be(a), this.ctx = e, this.id = new Fe(e.isolate, a).id, e.refStore.set(this.id, this), r === 0 && this._setWeak();
	}
	getPersistent() {
		return this.ctx.isolate.getRef(this.id);
	}
	ref() {
		let e = this.getPersistent();
		return e.isEmpty() ? 0 : (++this._refcount === 1 && this.canBeWeak && e.clearWeak(), this._refcount);
	}
	unref() {
		return this.getPersistent().isEmpty() || this._refcount === 0 ? 0 : (--this._refcount === 0 && this._setWeak(), this._refcount);
	}
	deref() {
		return this.getPersistent().deref();
	}
	get() {
		let e = this.getPersistent();
		return e.isEmpty() ? 0 : e.slot();
	}
	resetFinalizer() {}
	data() {
		return 0;
	}
	refcount() {
		return this._refcount;
	}
	ownership() {
		return this._ownership;
	}
	callUserFinalizer() {}
	invokeFinalizerFromGC() {
		this.finalize();
	}
	_setWeak() {
		this.setWeakWithData(this, e.weakCallback);
	}
	setWeakWithData(e, t) {
		let n = this.getPersistent();
		this.canBeWeak ? n.setWeak(e, t) : n.reset();
	}
	clearWeak() {
		this.getPersistent().clearWeak();
	}
	finalize() {
		this.getPersistent().reset();
		let e = this._ownership === ze.kRuntime;
		this.unlink(), this.callUserFinalizer(), e && this.dispose();
	}
	dispose() {
		this.id !== 0 && (this.unlink(), this.ctx.isolate.removeRef(this.id), this.ctx.refStore.delete(this.id), super.dispose(), this.ctx = void 0, this.envObject = void 0, this.id = 0);
	}
}, He = class e extends Ve {
	static create(t, n, r, i, a, o) {
		let s = new e(t, n, r, i, a, o);
		return n && s.link(n.reflist), s;
	}
	constructor(e, t, n, r, i, a) {
		super(e, t, n, r, i), this._data = a;
	}
	data() {
		return this._data;
	}
}, Ue = class e extends Ve {
	static create(t, n, r, i, a, o, s, c) {
		if (!n) throw TypeError("envObject is required for ReferenceWithFinalizer");
		let l = new e(t, n, r, i, a, o, s, c);
		return l.link(n.finalizing_reflist), l;
	}
	constructor(e, t, n, r, i, a, o, s) {
		super(e, t, n, r, i), this._finalizer = new De(t, a, o, s);
	}
	resetFinalizer() {
		this._finalizer.resetFinalizer();
	}
	data() {
		return this._finalizer.data();
	}
	callUserFinalizer() {
		this._finalizer.callFinalizer();
	}
	invokeFinalizerFromGC() {
		this._finalizer.envObject.invokeFinalizerFromGC(this);
	}
	dispose() {
		this._finalizer &&= (this._finalizer.envObject.dequeueFinalizer(this), this._finalizer.dispose(), super.dispose(), void 0);
	}
}, We = class e extends je {
	constructor(t) {
		super(e.MIN_ID), this._features = t, this._allocator = new ke(e.MIN_ID), this.refValues = /* @__PURE__ */ new Map(), this._values[2] = void 0, this._values[3] = null, this._values[4] = !1, this._values[5] = !0, this._values[6] = t.getGlobalThis(), this._values[7] = "";
		let n = (e, t) => {
			for (let n = e; n < t; ++n) this.dealloc(n);
		};
		this._erase = this._features.finalizer ? this._features.weakSymbol ? (e, t, r) => {
			if (!r) n(e, t);
			else for (let n = e; n < t; ++n) {
				let e = this._values[n], t = typeof e;
				(t === "object" && e !== null || t === "function" || t === "symbol" && Symbol.keyFor(e) === void 0) && (this._values[n] = new WeakRef(e));
			}
		} : (e, t, r) => {
			if (!r) n(e, t);
			else for (let n = e; n < t; ++n) {
				let e = this._values[n], t = typeof e;
				(t === "object" && e !== null || t === "function") && (this._values[n] = new WeakRef(e));
			}
		} : n, this._deref = this._features.finalizer ? (e) => {
			if (e = Number(e), e < 0 || e > 2147483647) {
				let t = this.refValues.get(e >>> 0);
				return t === void 0 ? void 0 : t.deref();
			}
			let t = this._values[e];
			return t instanceof WeakRef && this.isOutOfScope(e) ? t.deref() : t;
		} : (e) => {
			if (e = Number(e), e < 0 || e > 2147483647) {
				let t = this.refValues.get(e >>> 0);
				return t === void 0 ? void 0 : t.deref();
			}
			return this._values[e];
		};
	}
	isOutOfScope(e) {
		return e >= this._allocator.next;
	}
	deepDeref(e) {
		return this._deref(e);
	}
	push(e) {
		let t = this._allocator.aquire();
		return this._values[t] = e, t;
	}
	erase(e, t, n) {
		this._allocator.next = e, this._erase(e, t, n);
	}
	swap(e, t) {
		let n = this._values, r = n[e];
		n[e] = n[t], n[t] = r;
	}
};
We.MIN_ID = 8;
var Ge = /* @__PURE__ */ new WeakMap();
function Ke(e) {
	return Ge.has(e);
}
var qe = (() => {
	function e(e) {
		Object.setPrototypeOf(this, null), Ge.set(this, e);
	}
	return e.prototype = null, e;
})();
function Je(e) {
	if (!Ke(e)) throw TypeError("not external");
	return Ge.get(e);
}
var Ye = class e extends F {
	static create(t, n, r = t?.end ?? 1, i = r) {
		return new e(t, n, r, i);
	}
	constructor(e, t, n = e?.end ?? 1, r = n) {
		super(), this._escapeCalled = !1, this.handleStore = t, this.id = 0, this.parent = e, this.child = null, e !== null && (e.child = this), this.start = n, this.end = r, this.callbackInfo = {
			thiz: void 0,
			holder: void 0,
			data: 0,
			args: void 0,
			fn: void 0
		};
	}
	reuse(e) {
		this.start = this.end = e.end, this._escapeCalled = !1;
	}
	add(e) {
		let t = this.handleStore.push(e);
		return this.end = t + 1, t;
	}
	addExternal(e) {
		return this.add(new qe(e));
	}
	dispose() {
		let e = this.callbackInfo.fn === void 0;
		e || (this.callbackInfo.data = 0, this.callbackInfo.args = void 0, this.callbackInfo.thiz = void 0, this.callbackInfo.holder = void 0, this.callbackInfo.fn = void 0), this.start !== this.end && this.handleStore.erase(this.start, this.end, e);
	}
	escape(e) {
		if (e < this.start || e >= this.end) return e;
		if (this._escapeCalled) return 0;
		this._escapeCalled = !0;
		let t = this.start;
		return this.handleStore.swap(e, t), this.start++, this.parent.end++, t;
	}
	escapeCalled() {
		return this._escapeCalled;
	}
}, Xe = class extends je {
	constructor() {
		super(), this._rootScope = new Ye(null, null, 1, We.MIN_ID), this.currentScope = this._rootScope;
	}
	openScope(e) {
		let t = this.currentScope, n = t.child;
		if (n) n.reuse(t);
		else {
			n = new Ye(t, e);
			let r = t.id + 1;
			n.id = r, this._values[r] = n;
		}
		return this.currentScope = n, n;
	}
	closeScope() {
		let e = this.currentScope;
		this.currentScope = e.parent, e.dispose();
	}
	isEmpty() {
		return this.currentScope === this._rootScope;
	}
}, B = class e {
	constructor(t) {
		this.id = 0, this._exception = void 0, this._caught = !1, this._next = null, this.id = t, this._next = e.top, e.top = this, e._map.set(t, this);
	}
	static deref(e) {
		return this._map.get(e);
	}
	static pop() {
		let t = e.top;
		t && (e._map.delete(t.id), e.top = t._next, t._next = null, t.id = 0, t._exception = void 0, t._caught = !1);
	}
	isEmpty() {
		return !this._caught;
	}
	hasCaught() {
		return this._caught;
	}
	exception() {
		return this._exception;
	}
	rethrow(e) {
		if (this._caught) {
			let t = this.extractException();
			return e.setLastException(t), t;
		}
	}
	setError(e) {
		this._caught = !0, this._exception = e;
	}
	reset() {
		this._caught = !1, this._exception = void 0;
	}
	extractException() {
		let e = this._exception;
		return this.reset(), e;
	}
};
B.top = null, B._map = /* @__PURE__ */ new Map();
var Ze;
(function(e) {
	e[e.None = 0] = "None", e[e.ReadOnly = 1] = "ReadOnly", e[e.DontEnum = 2] = "DontEnum", e[e.DontDelete = 4] = "DontDelete";
})(Ze ||= {});
var Qe = class e {
	constructor(e) {
		this._properties = /* @__PURE__ */ new Map(), this.ctx = e;
	}
	set(e, t, n) {
		this._properties.set(e, [t, n]);
	}
	_addPropertiesToInstance(t) {
		this._properties.forEach((n, r) => {
			let [i, a] = n;
			i instanceof e ? "newInstance" in i ? Object.defineProperty(t, r, {
				value: i.newInstance(6),
				writable: !(a & 1),
				enumerable: !(a & 2),
				configurable: !(a & 4)
			}) : "getFunction" in i && Object.defineProperty(t, r, {
				value: i.getFunction(),
				writable: !(a & 1),
				enumerable: !(a & 2),
				configurable: !(a & 4)
			}) : Object.defineProperty(t, r, {
				value: i,
				writable: !(a & 1),
				enumerable: !(a & 2),
				configurable: !(a & 4)
			});
		});
	}
};
function $e(e, t) {
	let n = e;
	for (; n != null;) {
		let e = Reflect.ownKeys(n);
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = Object.getOwnPropertyDescriptor(n, i);
			if (a && (a.value === t || a.get === t || a.set === t)) return n;
		}
		n = Object.getPrototypeOf(n);
	}
	return e;
}
var et = /* @__PURE__ */ new WeakMap();
function tt(e) {
	return et.get(e)?.length ?? 0;
}
function nt(e, t) {
	return et.get(e)?.[t];
}
function rt(e, t, n) {
	let r = et.get(e);
	r ? r[t] = n : (r = [], r[t] = n, et.set(e, r));
}
var it = class extends Qe {
	constructor(e, t) {
		super(e), this.internalFieldCount = 0, this._accessors = /* @__PURE__ */ new Map(), this._instances = /* @__PURE__ */ new WeakSet(), this.Ctor = t ?? Object;
	}
	setNativeDataProperty(e, t, n, r, i, a, o, s, c) {
		let l = this._createAccessorConfig(e, t, n, r, i, a, o, s, c);
		this._accessors.set(e, l);
	}
	setNativeDataPropertyOnInstance(e, t, n, r, i, a, o, s, c, l) {
		let u = this._createAccessorConfig(t, n, r, i, a, o, s, c, l);
		this._instances.add(e), this._defineAccessor(e, u);
	}
	setInternalFieldCount(e) {
		this.internalFieldCount = e;
	}
	setNamedPropertyHandler(e) {
		this._namedPropertyHandler = e;
	}
	setIndexedPropertyHandler(e) {
		this._indexedPropertyHandler = e;
	}
	setCallAsFunctionHandler(e) {
		this._callAsFunctionHandler = e;
	}
	_createAccessorWrapper(e, t) {
		let { ctx: n } = this, r = this._instances, i = (e) => {
			let t = e;
			for (; t != null && !r.has(t);) t = Object.getPrototypeOf(t);
			return t || e;
		};
		function a(o) {
			if (e === "setter" && !r.has(this)) {
				Object.defineProperty(this, t.name, {
					value: o,
					writable: !(t.attribute & 1),
					enumerable: !(t.attribute & 2),
					configurable: !(t.attribute & 4)
				});
				return;
			}
			let s = n.openScope(), c = s.callbackInfo, l;
			try {
				c.data = t.data, c.args = e === "getter" ? [] : [o], c.thiz = this, c.holder = i(this), c.fn = a;
				let r = e === "getter" ? t.getterWrap(n.napiValueFromJsValue(t.name), n.getCurrentScope().id, t.getter) : t.setterWrap(n.napiValueFromJsValue(t.name), n.napiValueFromJsValue(o), n.getCurrentScope().id, t.setter);
				l = r ? n.jsValueFromNapiValue(r) : void 0;
			} catch (e) {
				n.throwException(e);
			}
			if (n.closeScope(s), n.hasPendingException()) {
				if (B.top) B.top.setError(n.getAndClearLastException());
				else throw n.getAndClearLastException();
			}
			return l;
		}
		return a;
	}
	applyToInstance(e) {
		this._instances.add(e);
		let t = Array(this.internalFieldCount);
		if (et.set(e, t), this._addPropertiesToInstance(e), this._accessors.forEach((t) => this._defineAccessor(e, t)), this._namedPropertyHandler || this._indexedPropertyHandler) {
			let n = this._createPropertyHandlerProxy(e);
			return this._instances.add(n), et.set(n, t), n;
		}
		return e;
	}
	_createPropertyHandlerProxy(e) {
		let { ctx: t } = this, n = this._namedPropertyHandler || this._indexedPropertyHandler, r = (e) => {
			let t = typeof e == "string" && /^(?:0|[1-9]\d*)$/.test(e) ? Number(e) : void 0;
			if (t !== void 0 && t <= 4294967294 && this._indexedPropertyHandler) return {
				config: this._indexedPropertyHandler,
				index: t
			};
			if (typeof e == "string" && this._namedPropertyHandler) return { config: this._namedPropertyHandler };
		}, i = (e, n, r, i, a, o) => {
			let s = a === "getter" ? e.getterWrap : a === "setter" ? e.setterWrap : a === "query" ? e.queryWrap : a === "deleter" ? e.deleterWrap : e.enumeratorWrap;
			if (!s) return {
				intercepted: !1,
				value: void 0
			};
			let c = t.openScope(), l = c.callbackInfo;
			l.data = e.data, l.args = a === "setter" ? [o] : [], l.thiz = r, l.holder = i, l.fn = function() {};
			let u = 0;
			try {
				let r = typeof n == "number" ? n : t.napiValueFromJsValue(n);
				u = a === "getter" ? s(r, c.id, e.getter) : a === "setter" ? s(r, t.napiValueFromJsValue(o), c.id, e.setter) : a === "query" ? s(r, c.id, e.query) : a === "deleter" ? s(r, c.id, e.deleter) : s(c.id, e.enumerator);
			} catch (e) {
				t.throwException(e);
			}
			let d = u ? t.jsValueFromNapiValue(u) : void 0;
			if (t.closeScope(c), t.hasPendingException()) {
				if (B.top) B.top.setError(t.getAndClearLastException());
				else throw t.getAndClearLastException();
			}
			return {
				intercepted: Number(u) !== 0,
				value: d
			};
		}, a = (t, n) => {
			let a = r(n);
			if (!a || !a.config.queryWrap) return Reflect.getOwnPropertyDescriptor(e, n);
			let o = i(a.config, a.index === void 0 ? String(n) : a.index, e, e, "query");
			if (!o.intercepted) return Reflect.getOwnPropertyDescriptor(e, n);
			if (o.value === void 0) return;
			let s = Number(o.value);
			return {
				value: Reflect.get(e, n, e),
				writable: !(s & 1),
				enumerable: !(s & 2),
				configurable: !(s & 4)
			};
		}, o;
		return o = new Proxy(e, {
			get(t, n, a) {
				let o = r(n);
				if (!o || !o.config.getterWrap) return Reflect.get(e, n, a);
				let s = i(o.config, o.index === void 0 ? String(n) : o.index, a, e, "getter");
				return s.intercepted ? s.value : Reflect.get(e, n, a);
			},
			set(t, n, a, o) {
				let s = r(n);
				return !s || !s.config.setterWrap ? Reflect.set(e, n, a, o) : i(s.config, s.index === void 0 ? String(n) : s.index, o, e, "setter", a).intercepted ? !0 : Reflect.set(e, n, a, o);
			},
			has(t, n) {
				let a = r(n);
				if (!a || !a.config.queryWrap) return Reflect.has(e, n);
				let s = i(a.config, a.index === void 0 ? String(n) : a.index, o, e, "query");
				return s.intercepted ? s.value !== void 0 : Reflect.has(e, n);
			},
			deleteProperty(t, n) {
				let a = r(n);
				if (!a || !a.config.deleterWrap) return Reflect.deleteProperty(e, n);
				let s = i(a.config, a.index === void 0 ? String(n) : a.index, o, e, "deleter");
				return s.intercepted ? !!s.value : Reflect.deleteProperty(e, n);
			},
			ownKeys(t) {
				let r = n;
				if (!r || !r.enumeratorWrap) return Reflect.ownKeys(e);
				let a = i(r, "", o, e, "enumerator");
				if (!Array.isArray(a.value)) return Reflect.ownKeys(e);
				let s = a.value.map((e) => typeof e == "number" ? String(e) : e);
				for (let t of Reflect.ownKeys(e)) {
					let n = Reflect.getOwnPropertyDescriptor(e, t);
					n && !n.configurable && !s.includes(t) && s.push(t);
				}
				return s;
			},
			getOwnPropertyDescriptor: a,
			defineProperty(t, n, r) {
				return Reflect.defineProperty(e, n, r);
			}
		}), o;
	}
	_createAccessorConfig(e, t, n, r, i, a, o, s, c) {
		let l = {
			name: e,
			getterWrap: t,
			setterWrap: n,
			getter: r,
			setter: i,
			data: a,
			attribute: o,
			getterSideEffectType: s,
			setterSideEffectType: c,
			getterFunction: void 0,
			setterFunction: void 0
		};
		return l.getterFunction = r ? this._createAccessorWrapper("getter", l) : void 0, l.setterFunction = i ? this._createAccessorWrapper("setter", l) : void 0, l;
	}
	_defineAccessor(e, t) {
		Object.defineProperty(e, t.name, {
			get: t.getterFunction,
			set: t.setterFunction,
			enumerable: !(t.attribute & 2),
			configurable: !(t.attribute & 4)
		});
	}
	newInstance(e) {
		let { ctx: t, Ctor: n } = this, r;
		if (this._callAsFunctionHandler) {
			let e = this;
			r = function(...n) {
				let i = t.openScope(), a = i.callbackInfo;
				a.data = e._callAsFunctionHandler.data, a.args = n, a.thiz = this, a.holder = this, a.fn = r;
				let o = 0;
				try {
					o = e._callAsFunctionHandler.callbackWrap(i.id, e._callAsFunctionHandler.callback);
				} catch (e) {
					t.throwException(e);
				}
				let s = typeof o == "bigint" ? Number(o) : o, c = s === 0 ? 0 : (() => {
					let e = t.jsValueFromNapiValue(o);
					return e === void 0 && s !== 1 && s !== 2 ? s >= 4294967296 || typeof o == "bigint" ? Math.trunc(Number(o) / 4294967296) : Number(o) >> 1 : e;
				})();
				if (t.closeScope(i), t.hasPendingException()) throw t.getAndClearLastException();
				return c;
			};
		} else try {
			r = new n();
		} catch (e) {
			t.throwException(e);
		}
		return this.applyToInstance(r), r;
	}
}, at = class {
	constructor(e) {
		this.receiver = e;
	}
}, ot = class extends Qe {
	constructor(e, t, n, r, i) {
		super(e), this.ctx = e, this.callback = t, this.v8FunctionCallback = n, this.data = r, this.className = void 0, this.signature = i, this.callHandler = void 0, this._cached = [void 0];
	}
	setCallHandler(e) {
		this.callHandler = e;
	}
	setClassName(e) {
		this.className = e;
	}
	instanceTemplate() {
		return this._instanceTemplate ||= new it(this.ctx), this._instanceTemplate;
	}
	prototypeTemplate() {
		return this._prototypeTemplate ||= new it(this.ctx), this._prototypeTemplate;
	}
	getFunction() {
		if (this._cached[0]) return this._cached[0];
		let { ctx: e, callback: t, v8FunctionCallback: n, data: r, signature: i, _instanceTemplate: a } = this, o = this.callHandler;
		function s() {
			if (i && i.receiver) {
				let e = i.receiver.getFunction();
				if (!(this instanceof e)) throw TypeError("Illegal invocation");
			}
			let c = e.openScope(), l = c.callbackInfo, u;
			try {
				let c = a && this instanceof s ? a.applyToInstance(this) : this;
				l.data = o ? o.data : r, l.args = arguments, l.thiz = c, l.holder = i ? c : $e(c, s) || c, l.fn = s;
				let d = o ? o.callbackWrap(e.getCurrentScope().id, o.callback) : t ? t(e.getCurrentScope().id, n) : 0;
				if (o) {
					let t = typeof d == "bigint" ? Number(d) : d;
					if (t === 0) u = 0;
					else {
						let n = e.jsValueFromNapiValue(d);
						u = n === void 0 && t !== 1 && t !== 2 ? t >= 4294967296 || typeof d == "bigint" ? Math.trunc(Number(d) / 4294967296) : Number(d) >> 1 : n;
					}
				} else u = d ? e.jsValueFromNapiValue(d) : void 0;
			} catch (t) {
				t !== "unwind" && e.throwException(t);
			} finally {
				e.closeScope(c);
			}
			if (e.hasPendingException()) {
				if (B.top) B.top.setError(e.getAndClearLastException());
				else throw e.getAndClearLastException();
			}
			return u;
		}
		return typeof this.className == "string" && this.ctx.features.setFunctionName?.(s, this.className), this._prototypeTemplate && this._prototypeTemplate.applyToInstance(s.prototype), this._addPropertiesToInstance(s), this._cached[0] = s, s;
	}
}, st = /* @__PURE__ */ new Map(), ct = /* @__PURE__ */ new WeakMap(), V = class e {
	constructor(e) {
		this._name = e;
	}
	name() {
		return this._name;
	}
	static forApi(t) {
		let n = st.get(t);
		return n || (n = new e(t), st.set(t, n)), n;
	}
};
function lt(e, t, n) {
	if (!(t instanceof V)) throw TypeError("Expected key to be an instance of Private");
	let r = ct.get(t);
	r || (r = /* @__PURE__ */ new WeakMap(), ct.set(t, r)), r.set(e, n);
}
function ut(e, t) {
	if (!(t instanceof V)) throw TypeError("Expected key to be an instance of Private");
	let n = ct.get(t);
	if (n) return n.get(e);
}
function dt(e, t) {
	if (!(t instanceof V)) throw TypeError("Expected key to be an instance of Private");
	let n = ct.get(t);
	return n ? n.has(e) : !1;
}
function ft(e, t) {
	if (!(t instanceof V)) throw TypeError("Expected key to be an instance of Private");
	let n = ct.get(t);
	return !n || !n.has(e) || n.delete(e);
}
var pt = BigInt(1) << BigInt(60), mt = -pt, ht = class {
	constructor(e) {
		this.total = BigInt(0), this.onChange = e ?? null;
	}
	adjust(e) {
		if (e = BigInt(e), !(mt <= e && e < pt)) throw RangeError(`changeInBytes ${e} is out of reasonable range`);
		let t = this.total;
		this.total += e;
		let n = this.total, r = this.onChange;
		return e && r?.(n, t, e), n;
	}
}, gt = class {
	constructor(e) {
		this.features = be(e?.features), this._globalThis = this.features.getGlobalThis(), this._scopeStore = new Xe(), this._handleStore = new We(this.features), this.globalHandleStore = new Ne(), this._globalIdentityStore = new Pe(this), this._lastException = new Fe(this), this._externalMemory = new ht(e?.onExternalMemoryChange);
	}
	napiValueFromJsValue(e) {
		switch (e) {
			case void 0: return 2;
			case null: return 3;
			case !1: return 4;
			case !0: return 5;
			case "": return 7;
			case this._globalThis: return 6;
			default: return this._scopeStore.currentScope.add(e);
		}
	}
	jsValueFromNapiValue(e) {
		return this._handleStore.deepDeref(e);
	}
	deleteRefSlotValue(e) {
		this._handleStore.refValues.delete(Number(e));
	}
	getRefSlotValue(e) {
		return this._handleStore.refValues.get(Number(e));
	}
	setRefSlotValue(e, t) {
		this._handleStore.refValues.set(Number(e), t);
	}
	createReference(...e) {
		return new Fe(this, ...e);
	}
	insertRef(e) {
		this.globalHandleStore.insert(e);
	}
	getRef(e) {
		return this.globalHandleStore.deref(e);
	}
	acquireGlobalValueIdentity(e) {
		return this._globalIdentityStore.acquire(e);
	}
	retainGlobalValueIdentity(e) {
		this._globalIdentityStore.retain(e);
	}
	releaseGlobalValueIdentity(e) {
		this._globalIdentityStore.release(e);
	}
	removeRef(e, t = !1) {
		t || this._scopeStore.isEmpty() ? this.globalHandleStore.deref(e)?.dispose() : this.globalHandleStore.markUnused(e);
	}
	getTryCatch(e) {
		return B.deref(e);
	}
	pushTryCatch(e) {
		return new B(e);
	}
	popTryCatch(e) {
		if (e !== B.top?.id) throw Error("TryCatch mismatch");
		return B.pop();
	}
	setLastException(e) {
		this._lastException.resetTo(e);
	}
	throwException(e) {
		return B.top ? B.top.setError(e) : this.setLastException(e), e;
	}
	hasPendingException() {
		return !this._lastException.isEmpty();
	}
	getAndClearLastException() {
		let e = this._lastException.deref();
		return this._lastException.reset(), e;
	}
	adjustAmountOfExternalAllocatedMemory(e) {
		return this._externalMemory.adjust(e);
	}
	createSignature(e) {
		return new at(e);
	}
	createObjectTemplate(e) {
		return new it(this, e);
	}
	setInternalField(e, t, n) {
		rt(e, t, n);
	}
	getInternalField(e, t) {
		return nt(e, t);
	}
	getInternalFieldCount(e) {
		return tt(e);
	}
	createFunctionTemplate(e, t, n, r) {
		return new ot(this, e, t, n, r);
	}
	isScopeEmpty() {
		return this._scopeStore.isEmpty();
	}
	getCurrentScope() {
		return this._scopeStore.currentScope;
	}
	openScope() {
		return this._scopeStore.openScope(this._handleStore);
	}
	closeScope(e) {
		this._scopeStore.closeScope(), this.isScopeEmpty() && this.globalHandleStore.recycle();
	}
	getHandleScope(e) {
		return this._scopeStore.deref(e);
	}
	getCallbackInfo(e) {
		return this._scopeStore.deref(e).callbackInfo;
	}
	createExternal(e) {
		return new qe(e);
	}
	getExternalValue(e) {
		return Je(e);
	}
	isExternal(e) {
		return Ke(e);
	}
	createResolver() {
		return this.features.withResolvers.call(Promise);
	}
	createPrivate(e) {
		return new V(e);
	}
	getOrCreateGlobalPrivate(e) {
		return V.forApi(e);
	}
	setPrivate(e, t, n) {
		return lt(e, t, n);
	}
	getPrivate(e, t) {
		return ut(e, t);
	}
	hasPrivate(e, t) {
		return dt(e, t);
	}
	deletePrivate(e, t) {
		return ft(e, t);
	}
}, _t = (e, t) => {
	let n = e.callIntoModule(t);
	return n ? e.ctx.jsValueFromNapiValue(n) : void 0;
}, vt = (e, t, n, r, i, a, o) => {
	let s = e.ctx.openScope(e), c = s.callbackInfo;
	c.data = r, c.args = n, c.thiz = t, c.fn = i;
	try {
		return a(e, o);
	} catch (e) {
		if (e !== "unwind") throw e;
	} finally {
		e.ctx.closeScope(e, s);
	}
}, yt = class {
	constructor(e, t, n) {
		this.envObject = e, this.fn = t, this.arg = n;
	}
}, bt = class e {
	constructor() {
		this._cleanupHooks = [];
	}
	empty() {
		return this._cleanupHooks.length === 0;
	}
	add(t, n, r) {
		if (this._cleanupHookIndex === void 0) {
			for (let e = 0; e < this._cleanupHooks.length; ++e) {
				let i = this._cleanupHooks[e];
				if (i.envObject === t && i.fn === n && i.arg === r) throw Error("Can not add same fn and arg twice");
			}
			this._cleanupHooks.push(new yt(t, n, r)), this._cleanupHooks.length > e.INDEX_THRESHOLD && this._createIndex();
			return;
		}
		let i = this._cleanupHookIndex.get(t);
		i === void 0 && (i = /* @__PURE__ */ new Map(), this._cleanupHookIndex.set(t, i));
		let a = i.get(n);
		if (a === void 0) a = /* @__PURE__ */ new Set(), i.set(n, a);
		else if (a.has(r)) throw Error("Can not add same fn and arg twice");
		a.add(r), this._cleanupHooks.push(new yt(t, n, r));
	}
	remove(e, t, n) {
		for (let r = 0; r < this._cleanupHooks.length; ++r) {
			let i = this._cleanupHooks[r];
			if (i.envObject === e && i.fn === t && i.arg === n) {
				this._cleanupHooks.splice(r, 1), this._deleteIndex(i);
				return;
			}
		}
	}
	drain() {
		let e = this._cleanupHooks.slice();
		for (let t = e.length - 1; t >= 0; --t) {
			let n = e[t];
			typeof n.fn == "number" ? n.envObject.bridge.makeDynCall_vp(n.fn)(n.arg) : n.fn(n.arg);
			let r = this._cleanupHooks.length - 1;
			if (this._cleanupHooks[r] === n) this._cleanupHooks.pop(), this._deleteIndex(n);
			else {
				let e = this._cleanupHooks.lastIndexOf(n);
				e !== -1 && (this._cleanupHooks.splice(e, 1), this._deleteIndex(n));
			}
		}
		this._cleanupHooks.length === 0 && (this._cleanupHookIndex = void 0);
	}
	_createIndex() {
		let e = /* @__PURE__ */ new WeakMap();
		for (let t = 0; t < this._cleanupHooks.length; ++t) {
			let n = this._cleanupHooks[t], r = e.get(n.envObject);
			r === void 0 && (r = /* @__PURE__ */ new Map(), e.set(n.envObject, r));
			let i = r.get(n.fn);
			i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(n.fn, i)), i.add(n.arg);
		}
		this._cleanupHookIndex = e;
	}
	_deleteIndex(e) {
		if (this._cleanupHookIndex === void 0) return;
		let t = this._cleanupHookIndex.get(e.envObject), n = t.get(e.fn);
		n.delete(e.arg), n.size === 0 && t.delete(e.fn), t.size === 0 && this._cleanupHookIndex.delete(e.envObject);
	}
	dispose() {
		this._cleanupHooks.length = 0, this._cleanupHookIndex = void 0;
	}
};
bt.INDEX_THRESHOLD = 16;
var xt = class {
	constructor(e) {
		this.refHandle = new e().port1, this.count = 0;
	}
	increase() {
		this.count === 0 && this.refHandle.ref && this.refHandle.ref(), this.count++;
	}
	decrease() {
		this.count !== 0 && (this.count === 1 && this.refHandle.unref && this.refHandle.unref(), this.count--);
	}
}, St = class {
	constructor(e) {
		this._isStopping = !1, this._canCallIntoJs = !0, this._suppressDestroy = !1, this.envStore = new Me(), this.refStore = /* @__PURE__ */ new Map(), this.isolate = new gt(e), this.features = this.isolate.features, this.cleanupQueue = new bt(), typeof process == "object" && process !== null && typeof process.once == "function" && this.features.MessageChannel && (this.refCounter = new xt(this.features.MessageChannel), process.once("beforeExit", () => {
			this._suppressDestroy || this.destroy();
		}));
	}
	getIsolate() {
		return this.isolate;
	}
	suppressDestroy() {
		this._suppressDestroy = !0;
	}
	getRuntimeVersions() {
		return {
			version: Ce,
			NODE_API_SUPPORTED_VERSION_MAX: 10,
			NAPI_VERSION_EXPERIMENTAL: we,
			NODE_API_DEFAULT_MODULE_API_VERSION: 8,
			NODE_MODULE_VERSION: Te
		};
	}
	createNotSupportWeakRefError(e, t) {
		return new R(e, t);
	}
	createNotSupportBufferError(e, t) {
		return new z(e, t);
	}
	createReference(e, t, n, r) {
		return Ve.create(this, e, t, n, r);
	}
	createReferenceWithData(e, t, n, r, i) {
		return He.create(this, e, t, n, r, i);
	}
	createReferenceWithFinalizer(e, t, n, r, i = 0, a = 0, o = 0) {
		return Ue.create(this, e, t, n, r, i, a, o);
	}
	createResolver() {
		return this.isolate.createResolver();
	}
	adjustAmountOfExternalAllocatedMemory(e) {
		return this.isolate.adjustAmountOfExternalAllocatedMemory(e);
	}
	createEnv(e, t, n, r) {
		if (t = typeof t == "number" ? t : 8, t < 8) t = 8;
		else if (t > 10 && t !== 2147483647) {
			let n = `${e} requires Node-API version ${t}, but this version of Node.js only supports version 10 add-ons.`;
			throw Error(n);
		}
		let i = new Re(this, this.envStore, { ...n });
		return i.filename = e, i.moduleApiVersion = t, i.nodeBinding = r, this.addCleanupHook(i, () => {
			i.unref();
		}, 0), i;
	}
	createFunction(e, t, n, r, i) {
		if (e.ctx !== this) throw Error(`The napi_env (${e.address}) is not created by this context`);
		let a = (e) => t(e.address, e.ctx.getCurrentScope().id), o, s = (e, t, n, r, i) => function() {
			return e(t, this, arguments, n, o, r, i);
		}, c;
		if (r && i && this.features.makeDynamicFunction) try {
			c = this.features.makeDynamicFunction("withScope", "envObject", "data", "callbackWrapper", "callback", "return function " + r + "(){return withScope(envObject,this,arguments,data," + r + ",callbackWrapper,callback)};");
		} catch {
			c = s;
		}
		else c = s;
		return o = c(vt, e, n, _t, a), c === s && this.features.setFunctionName && r && this.features.setFunctionName(o, r), o;
	}
	createTrackedFinalizer(e, t, n, r) {
		return Oe.create(e, t, n, r);
	}
	getCurrentScope() {
		return this.isolate.getCurrentScope();
	}
	openScope(e) {
		let t = this.isolate.openScope();
		return e.openHandleScopes++, t;
	}
	closeScope(e, t) {
		this.isolate.closeScope(t), e.openHandleScopes--;
	}
	getEnv(e) {
		return this.envStore.deref(e);
	}
	getRef(e) {
		return this.refStore.get(Number(e));
	}
	getHandleScope(e) {
		return this.isolate.getHandleScope(e);
	}
	getCallbackInfo(e) {
		return this.isolate.getCallbackInfo(e);
	}
	napiValueFromJsValue(e) {
		return this.isolate.napiValueFromJsValue(e);
	}
	jsValueFromNapiValue(e) {
		return this.isolate.jsValueFromNapiValue(e);
	}
	createExternal(e) {
		return this.isolate.createExternal(e);
	}
	getExternalValue(e) {
		return this.isolate.getExternalValue(e);
	}
	isExternal(e) {
		return this.isolate.isExternal(e);
	}
	addCleanupHook(e, t, n) {
		this.cleanupQueue.add(e, t, n);
	}
	removeCleanupHook(e, t, n) {
		this.cleanupQueue.remove(e, t, n);
	}
	runCleanup() {
		for (; !this.cleanupQueue.empty();) this.cleanupQueue.drain();
	}
	increaseWaitingRequestCounter() {
		this.refCounter?.increase();
	}
	decreaseWaitingRequestCounter() {
		this.refCounter?.decrease();
	}
	setCanCallIntoJs(e) {
		this._canCallIntoJs = e;
	}
	setStopping(e) {
		this._isStopping = e;
	}
	canCallIntoJs() {
		return this._canCallIntoJs && !this._isStopping;
	}
	getDylinkMetadata(e) {
		return Se(e);
	}
	destroy() {
		this.setStopping(!0), this.setCanCallIntoJs(!1), this.runCleanup();
	}
}, Ct;
function wt(e) {
	return new St(e);
}
function Tt() {
	return Ct ||= wt(), Ct;
}
//#endregion
//#region ../../node_modules/@napi-rs/wasm-runtime/dist/emnapi-plugins.js
function Et(e) {
	let { emnapiCtx: t, emnapiNodeBinding: n, emnapiAsyncWorkPoolSize: r } = e;
	var i = (function(i, a, o) {
		var s = {
			idGen: {},
			values: [void 0],
			queued: /* @__PURE__ */ new Set(),
			pending: [],
			pendingHead: 0,
			init: function() {
				let e = {
					nextId: 1,
					list: [],
					listHead: 0,
					generate: function() {
						let t;
						return e.listHead < e.list.length ? (t = e.list[e.listHead++], e.listHead === e.list.length && (e.list.length = 0, e.listHead = 0)) : (t = e.nextId, e.nextId++), t;
					},
					reuse: function(t) {
						e.list.push(t);
					}
				};
				s.idGen = e, s.values = [void 0], s.queued = /* @__PURE__ */ new Set(), s.pending = [], s.pendingHead = 0;
			},
			create: function(e, t, r, i, a, o) {
				let c = 0, l = 0;
				if (n) {
					let e = n.node.emitAsyncInit(t, r, -1);
					c = e.asyncId, l = e.triggerAsyncId;
				}
				let u = s.idGen.generate();
				return s.values[u] = {
					env: e,
					id: u,
					resource: t,
					asyncId: c,
					triggerAsyncId: l,
					status: 0,
					execute: i,
					complete: a,
					data: o
				}, u;
			},
			callComplete: function(r, i) {
				let o = r.complete, s = r.env, c = r.data, l = () => {
					if (!o) return;
					let n = a.emnapiEnv, r = t.openScope(n);
					try {
						n.callbackIntoModule(!0, () => {
							e.wasmTable.get(o)(s, i, c);
						});
					} finally {
						t.closeScope(n, r);
					}
				};
				n ? n.node.makeCallback(r.resource, l, [], {
					asyncId: r.asyncId,
					triggerAsyncId: r.triggerAsyncId
				}) : l();
			},
			queue: function(n) {
				let i = s.values[n];
				if (i && i.status === 0) {
					if (i.status = 1, s.queued.size >= (Math.abs(r) || 4)) {
						s.pendingHead >= 1024 && s.pendingHead * 2 >= s.pending.length && (s.pending.splice(0, s.pendingHead), s.pendingHead = 0), s.pending.push(n);
						return;
					}
					s.queued.add(n);
					let a = i.env, o = i.data, c = i.execute;
					i.status = 2, t.features.setImmediate(() => {
						if (e.wasmTable.get(c)(a, o), s.queued.delete(n), i.status = 3, t.features.setImmediate(() => {
							s.callComplete(i, 0);
						}), s.pendingHead < s.pending.length) {
							let e = s.pending[s.pendingHead++];
							s.pendingHead === s.pending.length && (s.pending.length = 0, s.pendingHead = 0), s.values[e].status = 0, s.queue(e);
						}
					});
				}
			},
			cancel: function(e) {
				let n = s.pending.indexOf(e, s.pendingHead);
				if (n !== -1) {
					let r = s.values[e];
					return r && r.status === 1 ? (r.status = 4, s.pending.splice(n, 1), s.pendingHead === s.pending.length && (s.pending.length = 0, s.pendingHead = 0), t.features.setImmediate(() => {
						s.callComplete(r, 11);
					}), 0) : 9;
				}
				return 9;
			},
			remove: function(e) {
				let t = s.values[e];
				t && (n && n.node.emitAsyncDestroy({
					asyncId: t.asyncId,
					triggerAsyncId: t.triggerAsyncId
				}), s.values[e] = void 0, s.idGen.reuse(e));
			}
		};
		let { _emnapi_node_emit_async_init: c, _emnapi_node_emit_async_destroy: l, _emnapi_runtime_keepalive_pop: u, _emnapi_runtime_keepalive_push: d } = e;
		var f = {
			pool: [],
			workerReady: null,
			globalAddress: 0,
			globalOffset: {
				idle_threads: 0,
				q: 4,
				next: 4,
				prev: 8,
				mutex: 12,
				cond: 16,
				exit_message: 20,
				end: 28
			},
			offset: {
				resource: 0,
				async_id: 8,
				trigger_async_id: 16,
				env: 24,
				status: 28,
				queue: 32,
				queue_next: 32,
				queue_prev: 36,
				data: 40,
				execute: 44,
				complete: 48,
				end: 52
			},
			ensureBufferFor(e) {
				let t = o.wasmMemory.buffer;
				return e > t.byteLength && (o.wasmMemory.grow(0), t = o.wasmMemory.buffer), t;
			},
			init() {
				if (f.pool = [], f.workerReady = null, o.PThread !== void 0) {
					o.PThread.unusedWorkers.forEach(f.addListener), Object.values(o.PThread.pthreads).forEach(f.addListener);
					let e = o.PThread.getNewWorker;
					o.PThread.getNewWorker = function() {
						let t = e.apply(this, arguments);
						return f.addListener(t), t;
					};
				}
			},
			addListener(e) {
				if (!e) return !1;
				if (e._emnapiAWMTListener) return !0;
				let t = function(e) {
					let t = (o.ENVIRONMENT_IS_NODE ? e : e.data).__emnapi__;
					if (t) {
						let e = t.type, n = t.payload;
						e === "async-work-complete" && f.callComplete(n.work, 0);
					}
				};
				return e._emnapiAWMTListener = {
					handler: t,
					dispose: function() {
						o.ENVIRONMENT_IS_NODE ? e.off("message", t) : e.removeEventListener("message", t, !1), delete e._emnapiAWMTListener;
					}
				}, o.ENVIRONMENT_IS_NODE ? e.on("message", t) : e.addEventListener("message", t, !1), !0;
			},
			initGlobal() {
				if (!f.globalAddress) {
					f.globalAddress = o._malloc(f.globalOffset.end), f.globalAddress >>>= 0;
					let e = f.globalOffset.end, t = f.globalAddress;
					new Uint8Array(f.ensureBufferFor(t + e), t, e).fill(0), f.queueInit(f.globalAddress + f.globalOffset.q), f.queueInit(f.globalAddress + f.globalOffset.exit_message);
				}
			},
			terminateWorkers() {
				f.pool.forEach((e) => {
					e._emnapiAWMTListener?.dispose(), e._emnapiTSFNListener?.dispose(), e.terminate();
				}), f.pool.length = 0;
			},
			initWorkers(e) {
				if (o.ENVIRONMENT_IS_PTHREAD) return f.workerReady ||= Promise.resolve();
				if (f.workerReady) return f.workerReady;
				if (!("emnapi_async_worker_create" in o.wasmInstance.exports)) throw TypeError("`emnapi_async_worker_create` is not exported, please try to add `--export=emnapi_async_worker_create` to linker flags");
				let t = o.wasmInstance.exports.emnapi_async_worker_create, n = [];
				f.initGlobal();
				for (let r = 0; r < e; ++r) n.push(t(1, f.globalAddress));
				let r = n.map((e) => {
					if (e === 0) return Promise.reject(/* @__PURE__ */ Error("Failed to create async worker"));
					let t;
					if (e < 0 && (t = f.pool[-e - 1], t)) return t.whenLoaded;
					e >>>= 0;
					let n = new DataView(f.ensureBufferFor(e + 20 + 4)).getInt32(e + 20, !0);
					return t = o.PThread.pthreads[n], t.whenLoaded;
				});
				return f.workerReady = Promise.all(r), f.workerReady;
			},
			getResource(t) {
				f.ensureBufferFor(t + f.offset.resource + 4);
				var n = new DataView(e.wasmMemory.buffer);
				return (n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer)).getUint32(t + f.offset.resource, !0);
			},
			getExecute(t) {
				f.ensureBufferFor(t + f.offset.execute + 4);
				var n = new DataView(e.wasmMemory.buffer);
				return (n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer)).getUint32(t + f.offset.execute, !0);
			},
			getComplete(t) {
				f.ensureBufferFor(t + f.offset.complete + 4);
				var n = new DataView(e.wasmMemory.buffer);
				return (n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer)).getUint32(t + f.offset.complete, !0);
			},
			getEnv(t) {
				f.ensureBufferFor(t + f.offset.env + 4);
				var n = new DataView(e.wasmMemory.buffer);
				return (n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer)).getUint32(t + f.offset.env, !0);
			},
			getData(t) {
				f.ensureBufferFor(t + f.offset.data + 4);
				var n = new DataView(e.wasmMemory.buffer);
				return (n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer)).getUint32(t + f.offset.data, !0);
			},
			getMutex() {
				let e = f.globalAddress + f.globalOffset.mutex, t = {
					lock() {
						let t = typeof window < "u" && typeof document < "u" && !o.ENVIRONMENT_IS_NODE, n = new Int32Array(f.ensureBufferFor(e + 4), e, 1);
						if (t) {
							for (;;) if (Atomics.compareExchange(n, 0, 0, 10) === 0) return;
						} else for (;;) {
							if (Atomics.compareExchange(n, 0, 0, 10) === 0) return;
							Atomics.wait(n, 0, 10);
						}
					},
					unlock() {
						let t = new Int32Array(f.ensureBufferFor(e + 4), e, 1);
						if (Atomics.compareExchange(t, 0, 10, 0) !== 10) throw Error("Tried to unlock while not holding the mutex");
						Atomics.notify(t, 0, 1);
					},
					execute(e) {
						t.lock();
						try {
							return e();
						} finally {
							t.unlock();
						}
					}
				};
				return t;
			},
			getCond() {
				let e = f.globalAddress + f.globalOffset.cond, t = f.getMutex();
				return {
					wait() {
						let n = new Int32Array(f.ensureBufferFor(e + 4), e, 1), r = Atomics.load(n, 0);
						t.unlock(), Atomics.wait(n, 0, r), t.lock();
					},
					signal() {
						let t = new Int32Array(f.ensureBufferFor(e + 4), e, 1);
						Atomics.add(t, 0, 1), Atomics.notify(t, 0, 1);
					}
				};
			},
			queueInit(t) {
				f.ensureBufferFor(t + 4 + 4);
				var n = new DataView(e.wasmMemory.buffer), r = () => n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer);
				r().setUint32(t, t, !0), r().setUint32(t + 4, t, !0);
			},
			queueInsertTail(t, n) {
				f.ensureBufferFor(t + 4 + 4), f.ensureBufferFor(n + 4 + 4);
				var r = new DataView(e.wasmMemory.buffer), i = () => r.buffer === e.wasmMemory.buffer ? r : r = new DataView(e.wasmMemory.buffer);
				i().setUint32(n, t, !0);
				let a = i().getUint32(t + 4, !0);
				i().setUint32(n + 4, a, !0);
				let o = i().getUint32(n + 4, !0);
				i().setUint32(o, n, !0), i().setUint32(t + 4, n, !0);
			},
			queueRemove(t) {
				f.ensureBufferFor(t + 4 + 4);
				var n = new DataView(e.wasmMemory.buffer), r = () => n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer);
				let i = r().getUint32(t + 4, !0), a = r().getUint32(t, !0);
				r().setUint32(i, a, !0), r().setUint32(a + 4, i, !0);
			},
			queueEmpty(t) {
				f.ensureBufferFor(t + 4);
				var n = new DataView(e.wasmMemory.buffer);
				return t == (n.buffer === e.wasmMemory.buffer ? n : n = new DataView(e.wasmMemory.buffer)).getUint32(t, !0);
			},
			scheduleWork: function(n) {
				f.workerReady?.ready || f.initWorkers(a._emnapi_async_work_pool_size()).then(() => {
					f.workerReady.ready = !0;
				}).catch((e) => {
					throw f.workerReady = null, e;
				}), d(), t.increaseWaitingRequestCounter();
				let r = new Int32Array(f.ensureBufferFor(n + f.offset.status + 4), n + f.offset.status, 1);
				Atomics.store(r, 0, 0);
				let i = f.getMutex(), o = f.getCond();
				i.lock();
				try {
					f.queueInsertTail(f.globalAddress + f.globalOffset.q, n + f.offset.queue);
				} catch (e) {
					throw u(), t.decreaseWaitingRequestCounter(), i.unlock(), e;
				}
				f.ensureBufferFor(f.globalAddress + f.globalOffset.idle_threads + 4);
				var s = new DataView(e.wasmMemory.buffer);
				(s.buffer === e.wasmMemory.buffer ? s : s = new DataView(e.wasmMemory.buffer)).getUint32(f.globalAddress + f.globalOffset.idle_threads, !0) > 0 && o.signal(), i.unlock();
			},
			cancelWork(n) {
				let r = !1;
				return f.getMutex().execute(() => {
					f.ensureBufferFor(n + f.offset.status + 4);
					var t = new DataView(e.wasmMemory.buffer);
					r = !f.queueEmpty(n + f.offset.queue) && (t.buffer === e.wasmMemory.buffer ? t : t = new DataView(e.wasmMemory.buffer)).getInt32(n + f.offset.status, !0) !== 2, r && f.queueRemove(n + f.offset.queue);
				}), !r || Atomics.compareExchange(new Int32Array(f.ensureBufferFor(n + f.offset.status + 4), n + f.offset.status, 1), 0, 0, 1) !== 0 ? 9 : (t.features.setImmediate(() => {
					f.callComplete(n, 11);
				}), 0);
			},
			callComplete: function(r, i) {
				u(), t.decreaseWaitingRequestCounter();
				let o = f.getComplete(r), s = f.getEnv(r), c = f.getData(r), l = a.emnapiEnv, d = t.openScope(l), p = () => {
					o && l.callbackIntoModule(!0, () => {
						e.wasmTable.get(o)(s, i, c);
					});
				};
				try {
					if (n) {
						let e = f.getResource(r), i = t.getRef(e).get(), a = t.jsValueFromNapiValue(i), o = new DataView(f.ensureBufferFor(r + f.offset.trigger_async_id + 8)), s = o.getFloat64(r + f.offset.async_id, !0), c = o.getFloat64(r + f.offset.trigger_async_id, !0);
						n.node.makeCallback(a, p, [], {
							asyncId: s,
							triggerAsyncId: c
						});
					} else p();
				} finally {
					t.closeScope(l, d);
				}
			}
		};
		s.init(), f.init();
		var p = a.singleThreadAsyncWork ? function(n, r, i, o, c, l, u) {
			if (!n) return 1;
			let d = a.emnapiEnv;
			if (d.checkGCAccess(), !o || !u) return d.setLastError(1);
			let f;
			if (f = r ? Object(t.jsValueFromNapiValue(r)) : {}, !i) return d.setLastError(1);
			let p = String(t.jsValueFromNapiValue(i)), m = s.create(n, f, p, o, c, l);
			u >>>= 0;
			var h = new DataView(e.wasmMemory.buffer);
			return (h.buffer === e.wasmMemory.buffer ? h : h = new DataView(e.wasmMemory.buffer)).setUint32(u, m, !0), d.clearLastError();
		} : function(n, r, i, s, l, u, d) {
			if (!n) return 1;
			let p = a.emnapiEnv;
			if (p.checkGCAccess(), !s || !d) return p.setLastError(1);
			let m;
			if (m = r ? Object(t.jsValueFromNapiValue(r)) : {}, !i) return p.setLastError(1);
			let h = f.offset.end, g = o._malloc(h);
			if (!g) return p.setLastError(9);
			g >>>= 0, new Uint8Array(f.ensureBufferFor(g + h)).subarray(g, g + h).fill(0);
			let _ = t.napiValueFromJsValue(m), v = t.createReference(p, _, 1, 1).id;
			var y = new DataView(e.wasmMemory.buffer), b = () => y.buffer === e.wasmMemory.buffer ? y : y = new DataView(e.wasmMemory.buffer);
			return b().setUint32(g, v, !0), c(_, i, -1, g + f.offset.async_id), b().setUint32(g + f.offset.env, n, !0), b().setUint32(g + f.offset.execute, s, !0), b().setUint32(g + f.offset.complete, l, !0), b().setUint32(g + f.offset.data, u, !0), f.queueInit(g + f.offset.queue), d >>>= 0, b().setUint32(d, g, !0), p.clearLastError();
		}, m = a.singleThreadAsyncWork ? function(e, t) {
			if (!e) return 1;
			let n = a.emnapiEnv;
			return n.checkGCAccess(), t ? (t >>>= 0, s.remove(t), n.clearLastError()) : n.setLastError(1);
		} : function(e, r) {
			if (!e) return 1;
			let i = a.emnapiEnv;
			if (i.checkGCAccess(), !r) return i.setLastError(1);
			r >>>= 0;
			let s = f.getResource(r);
			if (t.getRef(s).dispose(), n) {
				let e = new DataView(f.ensureBufferFor(r + f.offset.trigger_async_id + 8)), t = e.getFloat64(r + f.offset.async_id, !0), n = e.getFloat64(r + f.offset.trigger_async_id, !0);
				l(t, n);
			}
			return o._free(r), i.clearLastError();
		}, h = a.singleThreadAsyncWork ? function(e, t) {
			if (!e) return 1;
			let n = a.emnapiEnv;
			return t ? (t >>>= 0, s.queue(t), n.clearLastError()) : n.setLastError(1);
		} : function(e, t) {
			if (!e) return 1;
			let n = a.emnapiEnv;
			return t ? (t >>>= 0, f.scheduleWork(t), n.clearLastError()) : n.setLastError(1);
		}, g = a.singleThreadAsyncWork ? function(e, t) {
			if (!e) return 1;
			let n = a.emnapiEnv;
			if (!t) return n.setLastError(1);
			t >>>= 0;
			let r = s.cancel(t);
			return r === 0 ? n.clearLastError() : n.setLastError(r);
		} : function(e, t) {
			if (!e) return 1;
			let n = a.emnapiEnv;
			if (!t) return n.setLastError(1);
			t >>>= 0;
			let r = f.cancelWork(t);
			return r === 0 ? n.clearLastError() : n.setLastError(r);
		};
		function _(t) {
			t >>>= 0, f.globalAddress = t;
			let n = f.getMutex(), r = f.getCond();
			n.lock();
			let i = t + f.globalOffset.exit_message, s = t + f.globalOffset.idle_threads, c = t + f.globalOffset.q;
			for (var l = new DataView(e.wasmMemory.buffer), u = () => l.buffer === e.wasmMemory.buffer ? l : l = new DataView(e.wasmMemory.buffer);;) {
				for (f.ensureBufferFor(c + 4); f.queueEmpty(c);) Atomics.add(new Int32Array(f.ensureBufferFor(s + 4), s, 1), 0, 1), r.wait(), Atomics.sub(new Int32Array(f.ensureBufferFor(s + 4), s, 1), 0, 1);
				let t = u().getUint32(c, !0);
				if (t === i) {
					r.signal(), n.unlock();
					break;
				}
				let l = t - f.offset.queue;
				f.queueRemove(t), f.queueInit(t), n.unlock();
				let d = new Int32Array(f.ensureBufferFor(l + f.offset.status + 4), l + f.offset.status, 1);
				Atomics.load(d, 0) === 1 && o.abort("unreachable");
				let p = f.getExecute(l), m = f.getEnv(l), h = f.getData(l);
				e.wasmTable.get(p)(m, h), Atomics.store(d, 0, 2);
				let g = a.addonModule.postMessage;
				g({ __emnapi__: {
					type: "async-work-complete",
					payload: { work: l }
				} }), n.lock();
			}
			return 0;
		}
		function v(t, n) {
			if (typeof a.onCreateWorker != "function") throw TypeError("`options.onCreateWorker` is not a function");
			let r = [], i = [];
			if (!("emnapi_async_worker_create" in o.wasmInstance.exports)) throw TypeError("`emnapi_async_worker_create` is not exported, please try to add `--export=emnapi_async_worker_create` to linker flags");
			i.push(o.wasmInstance.exports.emnapi_async_worker_create(0, 0));
			let s;
			try {
				let c = a.onCreateWorker({
					type: "async-work",
					name: "emnapi-async-worker"
				}), l = () => {
					c.loaded && Promise.resolve().then(() => {
						f.terminateWorkers(), o.PThread.terminateAllThreads();
					});
				};
				o.ENVIRONMENT_IS_NODE ? c.on("error", l) : c.addEventListener("error", l, !1);
				let u = o.PThread.loadWasmModuleToWorker(c);
				f.addListener(c), e.emnapiTSFN !== void 0 && e.emnapiTSFN.addListener(c), r.push(u.then(() => {
					typeof c.unref == "function" && c.unref();
				})), s = f.pool.push(c) - 1;
				let d = i[0];
				c.threadBlockBase = d, c.postMessage({ __emnapi__: {
					type: "async-worker-init",
					payload: {
						arg: d,
						func: [t, n]
					}
				} });
			} catch (e) {
				let t = i[0];
				throw o._free(t), e;
			}
			return s;
		}
		function y(t, n) {
			if (a.addonModule.childThread) {
				if (typeof o.wasmInstance.exports.emnapi_async_worker_init != "function") throw TypeError("`emnapi_async_worker_init` is not exported, please try to add `--export=emnapi_async_worker_init` to linker flags");
				o.wasmInstance.exports.emnapi_async_worker_init(t), e.wasmTable.get(n[0])(n[1]);
			} else throw Error("startThread is only available in child threads");
		}
		return a.addonModule.initWorker = y, i._emnapi_async_worker = _, i._emnapi_spawn_worker = v, i.napi_cancel_async_work = g, i.napi_create_async_work = p, i.napi_delete_async_work = m, i.napi_queue_async_work = h, i;
	})({}, e, e);
	return { importObject: (e) => {
		Object.keys(i).forEach((t) => {
			t.startsWith("napi_") || t.startsWith("node_api_") ? e.napi[t] = i[t] : e.env[t] = i[t];
		});
	} };
}
function Dt(e) {
	let { emnapiCtx: t, emnapiNodeBinding: n, _emnapi_node_emit_async_destroy: r, _emnapi_node_emit_async_init: i, _emnapi_runtime_keepalive_pop: a, _emnapi_runtime_keepalive_push: o } = e;
	var s = (function(s, c, l) {
		let u = {
			_liveSet: {},
			offset: {
				__size__: 0,
				resource: 0,
				async_id: 0,
				trigger_async_id: 0,
				queue_size: 0,
				is_some: 0,
				queue: 0,
				async_pending: 0,
				async_u_fd: 0,
				thread_count: 0,
				state: 0,
				dispatch_state: 0,
				context: 0,
				max_queue_size: 0,
				ref: 0,
				env: 0,
				finalize_data: 0,
				finalize_cb: 0,
				call_js_cb: 0,
				handles_closing: 0,
				async_ref: 0,
				mutex: 0,
				cond: 0
			},
			init() {
				if (u._liveSet = /* @__PURE__ */ new Set(), u.offset.__size__ = 184, u.offset.resource = 0, u.offset.async_id = 8, u.offset.trigger_async_id = 16, u.offset.queue_size = 60, u.offset.is_some = 24, u.offset.queue = 64, u.offset.async_pending = 132, u.offset.async_u_fd = 96, u.offset.thread_count = 136, u.offset.state = 140, u.offset.dispatch_state = 144, u.offset.context = 148, u.offset.max_queue_size = 152, u.offset.ref = 156, u.offset.env = 160, u.offset.finalize_data = 164, u.offset.finalize_cb = 168, u.offset.call_js_cb = 172, u.offset.handles_closing = 176, u.offset.async_ref = 180, u.offset.mutex = 32, u.offset.cond = 56, u.offset.mutex = u.offset.mutex + 4, l.PThread !== void 0) {
					l.PThread.unusedWorkers.forEach(u.addListener), Object.values(l.PThread.pthreads).forEach(u.addListener);
					let e = l.PThread.getNewWorker;
					l.PThread.getNewWorker = function() {
						let t = e.apply(this, arguments);
						return u.addListener(t), t;
					};
				}
			},
			addListener(e) {
				if (!e) return !1;
				if (e._emnapiTSFNListener) return !0;
				let t = function(e) {
					let t = (l.ENVIRONMENT_IS_NODE ? e : e.data).__emnapi__;
					if (t) {
						let e = t.type, n = t.payload;
						if (e === "tsfn-send") {
							let e = n.tsfn + u.offset.async_pending;
							Atomics.load(new Int32Array(u.ensureBufferFor(e + 4)), e >>> 2) !== 0 && u.enqueue(n.tsfn);
						}
					}
				};
				return e._emnapiTSFNListener = {
					handler: t,
					dispose: function() {
						l.ENVIRONMENT_IS_NODE ? e.off("message", t) : e.removeEventListener("message", t, !1), delete e._emnapiTSFNListener;
					}
				}, l.ENVIRONMENT_IS_NODE ? e.on("message", t) : e.addEventListener("message", t, !1), !0;
			},
			ensureBufferFor(e) {
				let t = l.wasmMemory.buffer;
				return e > t.byteLength && (l.wasmMemory.grow(0), t = l.wasmMemory.buffer), t;
			},
			initQueue(e) {
				let t = l._malloc(8);
				return t ? (t >>>= 0, new Uint8Array(u.ensureBufferFor(t + 8), t, 8).fill(0), u.storeSizeTypeValue(e + u.offset.queue, t, !1), !0) : !1;
			},
			destroyQueue(e) {
				let t = u.loadSizeTypeValue(e + u.offset.queue, !1);
				if (t) {
					let e = u.loadSizeTypeValue(t, !1);
					for (; e !== 0;) {
						let t = u.loadSizeTypeValue(e + 4, !1);
						l._free(e), e = t;
					}
					l._free(t);
				}
			},
			pushQueue(e, t) {
				let n = u.loadSizeTypeValue(e + u.offset.queue, !1), r = u.loadSizeTypeValue(n, !1), i = u.loadSizeTypeValue(n + 4, !1), a = l._malloc(8);
				if (!a) throw Error("OOM");
				a >>>= 0, u.storeSizeTypeValue(a, t, !1), u.storeSizeTypeValue(a + 4, 0, !1), r === 0 && i === 0 ? (u.storeSizeTypeValue(n, a, !1), u.storeSizeTypeValue(n + 4, a, !1)) : (u.storeSizeTypeValue(i + 4, a, !1), u.storeSizeTypeValue(n + 4, a, !1)), u.addQueueSize(e);
			},
			shiftQueue(e) {
				let t = u.loadSizeTypeValue(e + u.offset.queue, !1), n = u.loadSizeTypeValue(t, !1);
				if (n === 0) return 0;
				let r = n, i = u.loadSizeTypeValue(n + 4, !1);
				u.storeSizeTypeValue(t, i, !1), i === 0 && u.storeSizeTypeValue(t + 4, 0, !1), u.storeSizeTypeValue(r + 4, 0, !1);
				let a = u.loadSizeTypeValue(r, !1);
				return l._free(r), u.subQueueSize(e), a;
			},
			push(e, t, n) {
				let r = u.getMutex(e), i = u.getCond(e), a = () => {
					let t = u.getQueueSize(e), n = u.getMaxQueueSize(e);
					return t >= n && n > 0 && u.getState(e) === 0;
				}, o = typeof window < "u" && typeof document < "u" && !l.ENVIRONMENT_IS_NODE, s = !1, c = r.execute(() => {
					for (; a();) {
						if (n === 0) return 15;
						if (o) return 21;
						i.wait();
					}
					return u.getState(e) === 0 ? (u.pushQueue(e, t), u.send(e), 0) : u.getThreadCount(e) === 0 ? 1 : (u.subThreadCount(e), u.getState(e) !== 2 || u.getThreadCount(e) !== 0 || (s = !0), 16);
				});
				return s && u.destroy(e), c;
			},
			getMutex(e) {
				let t = e + u.offset.mutex, n = {
					lock() {
						let e = typeof window < "u" && typeof document < "u" && !l.ENVIRONMENT_IS_NODE, n = new Int32Array(u.ensureBufferFor(t + 4), t, 1);
						if (e) {
							for (;;) if (Atomics.compareExchange(n, 0, 0, 10) === 0) return;
						} else for (;;) {
							if (Atomics.compareExchange(n, 0, 0, 10) === 0) return;
							Atomics.wait(n, 0, 10);
						}
					},
					unlock() {
						let e = new Int32Array(u.ensureBufferFor(t + 4), t, 1);
						if (Atomics.compareExchange(e, 0, 10, 0) !== 10) throw Error("Tried to unlock while not holding the mutex");
						Atomics.notify(e, 0, 1);
					},
					execute(e) {
						n.lock();
						try {
							return e();
						} finally {
							n.unlock();
						}
					}
				};
				return n;
			},
			getCond(e) {
				let t = e + u.offset.cond, n = u.getMutex(e);
				return {
					wait() {
						let e = new Int32Array(u.ensureBufferFor(t + 4), t, 1), r = Atomics.load(e, 0);
						n.unlock(), Atomics.wait(e, 0, r), n.lock();
					},
					signal() {
						let e = new Int32Array(u.ensureBufferFor(t + 4), t, 1);
						Atomics.add(e, 0, 1), Atomics.notify(e, 0, 1);
					}
				};
			},
			getQueueSize(e) {
				return u.loadSizeTypeValue(e + u.offset.queue_size, !0);
			},
			addQueueSize(e) {
				let t = u.offset.queue_size, n, r;
				n = new Uint32Array(u.ensureBufferFor(e + t + 4)), r = e + t >>> 2, Atomics.add(n, r, 1);
			},
			subQueueSize(e) {
				let t = u.offset.queue_size, n, r;
				n = new Uint32Array(u.ensureBufferFor(e + t + 4)), r = e + t >>> 2, Atomics.sub(n, r, 1);
			},
			getThreadCount(e) {
				return u.loadSizeTypeValue(e + u.offset.thread_count, !0);
			},
			addThreadCount(e) {
				let t = u.offset.thread_count, n, r;
				n = new Uint32Array(u.ensureBufferFor(e + t + 4)), r = e + t >>> 2, Atomics.add(n, r, 1);
			},
			subThreadCount(e) {
				let t = u.offset.thread_count, n, r;
				n = new Uint32Array(u.ensureBufferFor(e + t + 4)), r = e + t >>> 2, Atomics.sub(n, r, 1);
			},
			getState(e) {
				return Atomics.load(new Int32Array(u.ensureBufferFor(e + u.offset.state + 4)), e + u.offset.state >>> 2);
			},
			setState(e, t) {
				Atomics.store(new Int32Array(u.ensureBufferFor(e + u.offset.state + 4)), e + u.offset.state >>> 2, t);
			},
			getHandlesClosing(e) {
				return Atomics.load(new Int8Array(u.ensureBufferFor(e + u.offset.handles_closing + 1)), e + u.offset.handles_closing);
			},
			setHandlesClosing(e, t) {
				Atomics.store(new Int8Array(u.ensureBufferFor(e + u.offset.handles_closing + 1)), e + u.offset.handles_closing, t);
			},
			getDispatchState(e) {
				return Atomics.load(new Uint32Array(u.ensureBufferFor(e + u.offset.dispatch_state + 4)), e + u.offset.dispatch_state >>> 2);
			},
			getContext(e) {
				return u.loadSizeTypeValue(e + u.offset.context, !1);
			},
			getMaxQueueSize(e) {
				return u.loadSizeTypeValue(e + u.offset.max_queue_size, !0);
			},
			getEnv(e) {
				return u.loadSizeTypeValue(e + u.offset.env, !1);
			},
			getCallJSCb(e) {
				return u.loadSizeTypeValue(e + u.offset.call_js_cb, !1);
			},
			getRef(e) {
				return u.loadSizeTypeValue(e + u.offset.ref, !1);
			},
			getResource(e) {
				return u.loadSizeTypeValue(e + u.offset.resource, !1);
			},
			getFinalizeCb(e) {
				return u.loadSizeTypeValue(e + u.offset.finalize_cb, !1);
			},
			getFinalizeData(e) {
				return u.loadSizeTypeValue(e + u.offset.finalize_data, !1);
			},
			loadSizeTypeValue(e, t) {
				let n, r;
				return t ? (r = new Uint32Array(u.ensureBufferFor(e + 4)), n = Atomics.load(r, e >>> 2), n) : (r = new Int32Array(u.ensureBufferFor(e + 4)), n = Atomics.load(r, e >>> 2), n);
			},
			storeSizeTypeValue(e, t, n) {
				let r;
				n ? (r = new Uint32Array(u.ensureBufferFor(e + 4)), Atomics.store(r, e >>> 2, t)) : (r = new Int32Array(u.ensureBufferFor(e + 4)), Atomics.store(r, e >>> 2, t >>> 0));
			},
			releaseResources(i) {
				if (u.getState(i) !== 2) {
					u.setState(i, 2), u.getEnv(i);
					let s = c.emnapiEnv, l = u.getRef(i);
					l && t.getRef(l).dispose();
					let d = u.getResource(i);
					t.getRef(d).dispose(), u.ensureBufferFor(i + u.offset.is_some + 1);
					var o = new DataView(e.wasmMemory.buffer);
					(o.buffer === e.wasmMemory.buffer ? o : o = new DataView(e.wasmMemory.buffer)).setInt8(i + u.offset.is_some, 0, !0), t.removeCleanupHook(s, u.cleanup, i), s.unref();
					let f = i + u.offset.async_ref, p = f >>> 2, m = new Uint32Array(u.ensureBufferFor(f + 4));
					if (Atomics.load(m, p) > 0 && (Atomics.store(m, p, 0), a(), t.decreaseWaitingRequestCounter()), n) {
						let e = new DataView(u.ensureBufferFor(i + u.offset.trigger_async_id + 8)), t = e.getFloat64(i + u.offset.async_id, !0), n = e.getFloat64(i + u.offset.trigger_async_id, !0);
						r(t, n);
					}
				}
			},
			destroy(e) {
				u._liveSet.delete(e), u.destroyQueue(e), u.releaseResources(e), l._free(e);
			},
			emptyQueue(t) {
				let n = [];
				u.getMutex(t).execute(() => {
					for (; u.getQueueSize(t) > 0;) n.push(u.shiftQueue(t));
				});
				let r = u.getCallJSCb(t), i = u.getContext(t), a;
				for (let t = 0; t < n.length; t++) a = n[t], r && e.wasmTable.get(r)(0, 0, i, a);
			},
			maybeDelete(e) {
				let t = !1;
				u.getMutex(e).execute(() => {
					u.getThreadCount(e) > 0 ? u.releaseResources(e) : t = !0;
				}), t && u.destroy(e);
			},
			finalize(e) {
				u.getEnv(e);
				let r = c.emnapiEnv;
				t.openScope(r);
				let i = u.getFinalizeCb(e), a = u.getFinalizeData(e), o = u.getContext(e), s = () => {
					r.callFinalizerInternal(0, i, a, o);
				};
				try {
					if (u.emptyQueue(e), i) {
						if (n) {
							let r = u.getResource(e), i = t.getRef(r).get(), a = t.jsValueFromNapiValue(i), o = new DataView(u.ensureBufferFor(e + u.offset.trigger_async_id + 8)), c = o.getFloat64(e + u.offset.async_id, !0), l = o.getFloat64(e + u.offset.trigger_async_id, !0);
							n.node.makeCallback(a, s, [], {
								asyncId: c,
								triggerAsyncId: l
							});
						} else s();
					}
					u.maybeDelete(e);
				} finally {
					t.closeScope(r);
				}
			},
			cleanup(e) {
				u.closeHandlesAndMaybeDelete(e, 1);
			},
			closeHandlesAndMaybeDelete(e, n) {
				u.getEnv(e);
				let r = c.emnapiEnv;
				t.openScope(r);
				try {
					if (n && u.getMutex(e).execute(() => {
						u.setState(e, 1), u.getMaxQueueSize(e) > 0 && u.getCond(e).signal();
					}), u.getHandlesClosing(e)) return;
					u.setHandlesClosing(e, 1), Atomics.store(new Int32Array(u.ensureBufferFor(e + u.offset.async_pending + 4)), e + u.offset.async_pending >>> 2, 1), t.features.setImmediate(() => {
						u.finalize(e);
					});
				} finally {
					t.closeScope(r);
				}
			},
			dispatchOne(r) {
				let i = 0, a = !1, o = !1, s = u.getMutex(r), l = u.getCond(r);
				if (s.execute(() => {
					if (u.getState(r) === 0) {
						let e = u.getQueueSize(r);
						if (e > 0) {
							i = u.shiftQueue(r), a = !0;
							let t = u.getMaxQueueSize(r);
							e === t && t > 0 && l.signal(), e--;
						}
						e === 0 ? u.getThreadCount(r) === 0 && (u.setState(r, 1), u.getMaxQueueSize(r) > 0 && l.signal(), u.closeHandlesAndMaybeDelete(r, 0)) : o = !0;
					} else u.closeHandlesAndMaybeDelete(r, 0);
				}), a) {
					let a = u.getEnv(r), o = c.emnapiEnv;
					t.openScope(o);
					let s = () => {
						o.callbackIntoModule(!1, () => {
							let n = u.getCallJSCb(r), o = u.getRef(r), s = o ? t.getRef(o).get() : 0;
							if (n) {
								let t = u.getContext(r);
								e.wasmTable.get(n)(a, s, t, i);
							} else {
								let e = s ? t.jsValueFromNapiValue(s) : null;
								typeof e == "function" && e();
							}
						});
					};
					try {
						if (n) {
							let e = u.getResource(r), i = t.getRef(e).get(), a = t.jsValueFromNapiValue(i), o = new DataView(u.ensureBufferFor(r + u.offset.trigger_async_id + 8));
							n.node.makeCallback(a, s, [], {
								asyncId: o.getFloat64(r + u.offset.async_id, !0),
								triggerAsyncId: o.getFloat64(r + u.offset.trigger_async_id, !0)
							});
						} else s();
					} finally {
						t.closeScope(o);
					}
				}
				return o;
			},
			dispatch(e) {
				let t = !0, n = 1e3, r = e + u.offset.dispatch_state, i = r >>> 2;
				for (; t && --n !== 0;) {
					Atomics.store(new Uint32Array(u.ensureBufferFor(r + 4)), i, 1);
					try {
						t = u.dispatchOne(e);
					} catch (t) {
						throw u._liveSet.has(e) && (Atomics.exchange(new Uint32Array(u.ensureBufferFor(r + 4)), i, 0), u.send(e)), t;
					}
					Atomics.exchange(new Uint32Array(u.ensureBufferFor(r + 4)), i, 0) !== 1 && (t = !0);
				}
				t && u.send(e);
			},
			enqueue(e) {
				let n = e + u.offset.async_pending, r = e + u.offset.async_u_fd, i = Math.max(n, r) + 4, a = () => new Int32Array(u.ensureBufferFor(i));
				Atomics.exchange(a(), r >>> 2, 1) === 0 && t.features.setImmediate(() => {
					u._liveSet.has(e) && (Atomics.load(a(), n >>> 2) === 0 ? Atomics.store(a(), r >>> 2, 0) : t.features.setImmediate(() => {
						if (u._liveSet.has(e)) try {
							if (Atomics.exchange(a(), n >>> 2, 0) === 0) return;
							u.dispatch(e);
						} finally {
							u._liveSet.has(e) && (Atomics.store(a(), r >>> 2, 0), Atomics.load(a(), n >>> 2) !== 0 && u.enqueue(e));
						}
					}));
				});
			},
			send(e) {
				let t = e + u.offset.dispatch_state;
				if ((Atomics.or(new Uint32Array(u.ensureBufferFor(t + 4)), t >>> 2, 2) & 1) == 1) return;
				let n = e + u.offset.async_pending;
				Atomics.load(new Int32Array(u.ensureBufferFor(n + 4)), n >>> 2) === 0 && Atomics.exchange(new Int32Array(u.ensureBufferFor(n + 4)), n >>> 2, 1) === 0 && (l.ENVIRONMENT_IS_PTHREAD !== void 0 && l.ENVIRONMENT_IS_PTHREAD ? postMessage({ __emnapi__: {
					type: "tsfn-send",
					payload: { tsfn: e }
				} }) : u.enqueue(e));
			}
		};
		u.init(), e.emnapiTSFN = u;
		function d(n, r, a, s, d, f, p, m, h, g, _) {
			if (!n) return 1;
			let v = c.emnapiEnv;
			if (v.checkGCAccess(), !s || (d >>>= 0, f >>>= 0, n >>>= 0, p >>>= 0, m >>>= 0, h >>>= 0, g >>>= 0, d >>>= 0, f >>>= 0, f === 0) || !_) return v.setLastError(1);
			let y = 0;
			if (r >>>= 0, r) {
				if (typeof t.jsValueFromNapiValue(r) != "function") return v.setLastError(1);
				y = t.createReference(v, r, 1, 1).id;
			} else if (!g) return v.setLastError(1);
			let b;
			if (a) {
				if (b = t.jsValueFromNapiValue(a), b == null) return v.setLastError(2);
				b = Object(b);
			} else b = {};
			let x = t.napiValueFromJsValue(b), S = t.jsValueFromNapiValue(s);
			if (typeof S == "symbol") return v.setLastError(3);
			S = String(S);
			let C = t.napiValueFromJsValue(S), w = u.offset.__size__, T = l._malloc(w);
			if (!T) return v.setLastError(9);
			T >>>= 0, new Uint8Array(u.ensureBufferFor(T + w)).subarray(T, T + w).fill(0);
			let E = t.createReference(v, x, 1, 1), ee = E.id;
			var D = new DataView(e.wasmMemory.buffer), O = () => D.buffer === e.wasmMemory.buffer ? D : D = new DataView(e.wasmMemory.buffer);
			return O().setUint32(T + u.offset.resource, ee, !0), u.initQueue(T) ? (i(x, C, -1, T + u.offset.async_id), O().setInt8(T + u.offset.is_some, 1, !0), O().setUint32(T + u.offset.thread_count, f, !0), O().setUint32(T + u.offset.context, h, !0), O().setUint32(T + u.offset.max_queue_size, d, !0), O().setUint32(T + u.offset.ref, y, !0), O().setUint32(T + u.offset.env, n, !0), O().setUint32(T + u.offset.finalize_data, p, !0), O().setUint32(T + u.offset.finalize_cb, m, !0), O().setUint32(T + u.offset.call_js_cb, g, !0), t.addCleanupHook(v, u.cleanup, T), u._liveSet.add(T), v.ref(), o(), t.increaseWaitingRequestCounter(), O().setUint32(T + u.offset.async_ref, 1, !0), _ >>>= 0, O().setUint32(_, T, !0), v.clearLastError()) : (l._free(T), E.dispose(), v.setLastError(9));
		}
		function f(t, n) {
			if (!t || !n) return l.abort(), 1;
			t >>>= 0, n >>>= 0;
			let r = u.getContext(t);
			var i = new DataView(e.wasmMemory.buffer);
			return (i.buffer === e.wasmMemory.buffer ? i : i = new DataView(e.wasmMemory.buffer)).setUint32(n, r, !0), 0;
		}
		function p(e, t, n) {
			return e ? (e >>>= 0, t >>>= 0, u.push(e, t, n)) : (l.abort(), 1);
		}
		function m(e) {
			return e ? (e >>>= 0, u.getMutex(e).execute(() => u.getState(e) === 0 ? (u.addThreadCount(e), 0) : 16)) : (l.abort(), 1);
		}
		function h(e, t) {
			if (!e) return l.abort(), 1;
			e >>>= 0;
			let n = u.getMutex(e), r = u.getCond(e), i = !1, a = n.execute(() => u.getThreadCount(e) === 0 ? 1 : (u.subThreadCount(e), (u.getThreadCount(e) === 0 || t === 1) && u.getState(e) === 0 && (t === 1 && u.setState(e, 1), u.getState(e) === 1 && u.getMaxQueueSize(e) > 0 && r.signal(), u.send(e)), u.getState(e) !== 2 || u.getThreadCount(e) !== 0 || (i = !0), 0));
			return i && u.destroy(e), a;
		}
		function g(e, n) {
			if (!n) return l.abort(), 1;
			n >>>= 0;
			let r = n + u.offset.async_ref, i = r >>> 2, o = new Uint32Array(u.ensureBufferFor(r + 4)), s = Atomics.load(o, i);
			return s > 0 && (Atomics.store(o, i, s - 1), s === 1 && (a(), t.decreaseWaitingRequestCounter())), 0;
		}
		function _(e, n) {
			if (!n) return l.abort(), 1;
			n >>>= 0;
			let r = n + u.offset.async_ref, i = r >>> 2, a = new Uint32Array(u.ensureBufferFor(r + 4)), s = Atomics.load(a, i);
			return s || (o(), t.increaseWaitingRequestCounter()), Atomics.store(a, i, s + 1), 0;
		}
		return s.napi_acquire_threadsafe_function = m, s.napi_call_threadsafe_function = p, s.napi_create_threadsafe_function = d, s.napi_get_threadsafe_function_context = f, s.napi_ref_threadsafe_function = _, s.napi_release_threadsafe_function = h, s.napi_unref_threadsafe_function = g, s;
	})({}, e, e);
	return { importObject: (e) => {
		Object.assign(e.napi, s);
	} };
}
//#endregion
//#region ../../node_modules/@tybys/wasm-util/dist/wasm-util.esm-bundler.js
var Ot = typeof WebAssembly < "u" ? WebAssembly : typeof WXWebAssembly < "u" ? WXWebAssembly : void 0;
if (!Ot) throw Error("WebAssembly is not supported in this environment");
function kt(e, t) {
	if (typeof e != "object" || !e) throw TypeError(`${t} must be an object. Received ${e === null ? "null" : typeof e}`);
}
function At(e, t) {
	if (!Array.isArray(e)) throw TypeError(`${t} must be an array. Received ${e === null ? "null" : typeof e}`);
}
function jt(e, t) {
	if (typeof e != "boolean") throw TypeError(`${t} must be a boolean. Received ${e === null ? "null" : typeof e}`);
}
function Mt(e, t) {
	if (typeof e != "string") throw TypeError(`${t} must be a string. Received ${e === null ? "null" : typeof e}`);
}
function Nt(e, t) {
	if (typeof e != "function") throw TypeError(`${t} must be a function. Received ${e === null ? "null" : typeof e}`);
}
function Pt(e, t) {
	if (e !== void 0) throw TypeError(`${t} must be undefined. Received ${e === null ? "null" : typeof e}`);
}
function Ft(e) {
	return !(!e || typeof e != "object" && typeof e != "function" || typeof e.then != "function");
}
function It(e, t) {
	let n = Date.now() + e, r = !1;
	for (; Date.now() < n;) if (t()) {
		r = !0;
		break;
	}
	return r;
}
function H(e, t, n) {
	return typeof SharedArrayBuffer == "function" && e.buffer instanceof SharedArrayBuffer || Object.prototype.toString.call(e.buffer.constructor) === "[object SharedArrayBuffer]" ? e.slice(t, n) : e.subarray(t, n);
}
var Lt = 46, Rt = 47, zt = 92, Bt = 58, Vt = 65, Ht = 90, Ut = 97, Wt = 122;
function U(e) {
	return e === Rt || e === zt;
}
function Gt(e) {
	return e >= Vt && e <= Ht || e >= Ut && e <= Wt;
}
var Kt = typeof process < "u" && process.platform === "win32";
function qt(e) {
	let t = "", n = "", r = !1;
	for (let i = e.length - 1; i >= -1; i--) {
		let a;
		if (i >= 0) {
			if (a = e[i], Mt(a, "path"), a.length === 0) continue;
		} else if (t.length === 0) a = typeof process < "u" && typeof process.cwd == "function" ? process.cwd() : "";
		else {
			let e = `=${t}`, n = typeof process < "u" ? process.env : void 0;
			a = n && typeof n[e] == "string" ? n[e] : typeof process < "u" && typeof process.cwd == "function" ? process.cwd() : "", (a === void 0 || a.slice(0, 2).toLowerCase() !== t.toLowerCase() && a.charCodeAt(2) === zt) && (a = `${t}\\`);
		}
		let o = a.length, s = 0, c = "", l = !1, u = a.charCodeAt(0);
		if (o === 1) U(u) && (s = 1, l = !0);
		else if (U(u)) {
			if (l = !0, U(a.charCodeAt(1))) {
				let e = 2, t = e;
				for (; e < o && !U(a.charCodeAt(e));) e++;
				if (e < o && e !== t) {
					let n = a.slice(t, e);
					for (t = e; e < o && U(a.charCodeAt(e));) e++;
					if (e < o && e !== t) {
						for (t = e; e < o && !U(a.charCodeAt(e));) e++;
						(e === o || e !== t) && (c = `\\\\${n}\\${a.slice(t, e)}`, s = e);
					}
				}
			} else s = 1;
		} else Gt(u) && a.charCodeAt(1) === Bt && (c = a.slice(0, 2), s = 2, o > 2 && U(a.charCodeAt(2)) && (l = !0, s = 3));
		if (c.length > 0) {
			if (t.length > 0) {
				if (c.toLowerCase() !== t.toLowerCase()) continue;
			} else t = c;
		}
		if (r) {
			if (t.length > 0) break;
		} else if (n = `${a.slice(s)}\\${n}`, r = l, l && t.length > 0) break;
	}
	return n = Yt(n, !r, "\\", U), t + (r ? "\\" : "") + n || ".";
}
function Jt(e) {
	return e === Rt;
}
function Yt(e, t, n, r) {
	let i = "", a = 0, o = -1, s = 0, c = 0;
	for (let l = 0; l <= e.length; ++l) {
		if (l < e.length) c = e.charCodeAt(l);
		else if (r(c)) break;
		else c = Rt;
		if (r(c)) {
			if (o !== l - 1 && s !== 1) {
				if (s === 2) {
					if (i.length < 2 || a !== 2 || i.charCodeAt(i.length - 1) !== Lt || i.charCodeAt(i.length - 2) !== Lt) {
						if (i.length > 2) {
							let e = i.indexOf(n);
							e === -1 ? (i = "", a = 0) : (i = i.slice(0, e), a = i.length - 1 - i.indexOf(n)), o = l, s = 0;
							continue;
						}
						if (i.length !== 0) {
							i = "", a = 0, o = l, s = 0;
							continue;
						}
					}
					t && (i += i.length > 0 ? `${n}..` : "..", a = 2);
				} else i.length > 0 ? i += `${n}${e.slice(o + 1, l)}` : i = e.slice(o + 1, l), a = l - o - 1;
			}
			o = l, s = 0;
		} else c === Lt && s !== -1 ? ++s : s = -1;
	}
	return i;
}
function W(...e) {
	if (Kt) return qt(e);
	let t = "", n = !1;
	for (let r = e.length - 1; r >= -1 && !n; r--) {
		let i = r >= 0 ? e[r] : "/";
		Mt(i, "path"), i.length !== 0 && (t = `${i}/${t}`, n = i.charCodeAt(0) === Rt);
	}
	return t = Yt(t, !n, "/", Jt), n ? `/${t}` : t.length > 0 ? t : ".";
}
var G = {
	FD_DATASYNC: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(0),
	FD_READ: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(1),
	FD_SEEK: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(2),
	FD_FDSTAT_SET_FLAGS: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(3),
	FD_SYNC: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(4),
	FD_TELL: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(5),
	FD_WRITE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(6),
	FD_ADVISE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(7),
	FD_ALLOCATE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(8),
	PATH_CREATE_DIRECTORY: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(9),
	PATH_CREATE_FILE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(10),
	PATH_LINK_SOURCE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(11),
	PATH_LINK_TARGET: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(12),
	PATH_OPEN: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(13),
	FD_READDIR: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(14),
	PATH_READLINK: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(15),
	PATH_RENAME_SOURCE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(16),
	PATH_RENAME_TARGET: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(17),
	PATH_FILESTAT_GET: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(18),
	PATH_FILESTAT_SET_SIZE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(19),
	PATH_FILESTAT_SET_TIMES: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(20),
	FD_FILESTAT_GET: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(21),
	FD_FILESTAT_SET_SIZE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(22),
	FD_FILESTAT_SET_TIMES: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(23),
	PATH_SYMLINK: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(24),
	PATH_REMOVE_DIRECTORY: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(25),
	PATH_UNLINK_FILE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(26),
	POLL_FD_READWRITE: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(27),
	SOCK_SHUTDOWN: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(28),
	SOCK_ACCEPT: /*#__PURE__*/ BigInt(1) << /*#__PURE__*/ BigInt(29)
};
function Xt(e) {
	switch (e) {
		case 0: return "Success";
		case 1: return "Argument list too long";
		case 2: return "Permission denied";
		case 3: return "Address in use";
		case 4: return "Address not available";
		case 5: return "Address family not supported by protocol";
		case 6: return "Resource temporarily unavailable";
		case 7: return "Operation already in progress";
		case 8: return "Bad file descriptor";
		case 9: return "Bad message";
		case 10: return "Resource busy";
		case 11: return "Operation canceled";
		case 12: return "No child process";
		case 13: return "Connection aborted";
		case 14: return "Connection refused";
		case 15: return "Connection reset by peer";
		case 16: return "Resource deadlock would occur";
		case 17: return "Destination address required";
		case 18: return "Domain error";
		case 19: return "Quota exceeded";
		case 20: return "File exists";
		case 21: return "Bad address";
		case 22: return "File too large";
		case 23: return "Host is unreachable";
		case 24: return "Identifier removed";
		case 25: return "Illegal byte sequence";
		case 26: return "Operation in progress";
		case 27: return "Interrupted system call";
		case 28: return "Invalid argument";
		case 29: return "I/O error";
		case 30: return "Socket is connected";
		case 31: return "Is a directory";
		case 32: return "Symbolic link loop";
		case 33: return "No file descriptors available";
		case 34: return "Too many links";
		case 35: return "Message too large";
		case 36: return "Multihop attempted";
		case 37: return "Filename too long";
		case 38: return "Network is down";
		case 39: return "Connection reset by network";
		case 40: return "Network unreachable";
		case 41: return "Too many files open in system";
		case 42: return "No buffer space available";
		case 43: return "No such device";
		case 44: return "No such file or directory";
		case 45: return "Exec format error";
		case 46: return "No locks available";
		case 47: return "Link has been severed";
		case 48: return "Out of memory";
		case 49: return "No message of the desired type";
		case 50: return "Protocol not available";
		case 51: return "No space left on device";
		case 52: return "Function not implemented";
		case 53: return "Socket not connected";
		case 54: return "Not a directory";
		case 55: return "Directory not empty";
		case 56: return "State not recoverable";
		case 57: return "Not a socket";
		case 58: return "Not supported";
		case 59: return "Not a tty";
		case 60: return "No such device or address";
		case 61: return "Value too large for data type";
		case 62: return "Previous owner died";
		case 63: return "Operation not permitted";
		case 64: return "Broken pipe";
		case 65: return "Protocol error";
		case 66: return "Protocol not supported";
		case 67: return "Protocol wrong type for socket";
		case 68: return "Result not representable";
		case 69: return "Read-only file system";
		case 70: return "Invalid seek";
		case 71: return "No such process";
		case 72: return "Stale file handle";
		case 73: return "Operation timed out";
		case 74: return "Text file busy";
		case 75: return "Cross-device link";
		case 76: return "Capabilities insufficient";
		default: return "Unknown error";
	}
}
var K = class extends Error {
	constructor(e, t) {
		super(e), this.errno = t;
	}
	getErrorMessage() {
		return Xt(this.errno);
	}
};
Object.defineProperty(K.prototype, "name", {
	configurable: !0,
	writable: !0,
	value: "WasiError"
});
var Zt = G.FD_DATASYNC | G.FD_READ | G.FD_SEEK | G.FD_FDSTAT_SET_FLAGS | G.FD_SYNC | G.FD_TELL | G.FD_WRITE | G.FD_ADVISE | G.FD_ALLOCATE | G.PATH_CREATE_DIRECTORY | G.PATH_CREATE_FILE | G.PATH_LINK_SOURCE | G.PATH_LINK_TARGET | G.PATH_OPEN | G.FD_READDIR | G.PATH_READLINK | G.PATH_RENAME_SOURCE | G.PATH_RENAME_TARGET | G.PATH_FILESTAT_GET | G.PATH_FILESTAT_SET_SIZE | G.PATH_FILESTAT_SET_TIMES | G.FD_FILESTAT_GET | G.FD_FILESTAT_SET_TIMES | G.FD_FILESTAT_SET_SIZE | G.PATH_SYMLINK | G.PATH_UNLINK_FILE | G.PATH_REMOVE_DIRECTORY | G.POLL_FD_READWRITE | G.SOCK_SHUTDOWN | G.SOCK_ACCEPT, Qt = Zt, $t = Zt, en = Zt, tn = Zt, nn = G.FD_DATASYNC | G.FD_READ | G.FD_SEEK | G.FD_FDSTAT_SET_FLAGS | G.FD_SYNC | G.FD_TELL | G.FD_WRITE | G.FD_ADVISE | G.FD_ALLOCATE | G.FD_FILESTAT_GET | G.FD_FILESTAT_SET_SIZE | G.FD_FILESTAT_SET_TIMES | G.POLL_FD_READWRITE, rn = /*#__PURE__*/ BigInt(0), an = G.FD_FDSTAT_SET_FLAGS | G.FD_SYNC | G.FD_ADVISE | G.PATH_CREATE_DIRECTORY | G.PATH_CREATE_FILE | G.PATH_LINK_SOURCE | G.PATH_LINK_TARGET | G.PATH_OPEN | G.FD_READDIR | G.PATH_READLINK | G.PATH_RENAME_SOURCE | G.PATH_RENAME_TARGET | G.PATH_FILESTAT_GET | G.PATH_FILESTAT_SET_SIZE | G.PATH_FILESTAT_SET_TIMES | G.FD_FILESTAT_GET | G.FD_FILESTAT_SET_TIMES | G.PATH_SYMLINK | G.PATH_UNLINK_FILE | G.PATH_REMOVE_DIRECTORY | G.POLL_FD_READWRITE, on = an | nn, sn = G.FD_READ | G.FD_FDSTAT_SET_FLAGS | G.FD_WRITE | G.FD_FILESTAT_GET | G.POLL_FD_READWRITE | G.SOCK_SHUTDOWN, cn = Zt, ln = G.FD_READ | G.FD_FDSTAT_SET_FLAGS | G.FD_WRITE | G.FD_FILESTAT_GET | G.POLL_FD_READWRITE, un = /*#__PURE__*/ BigInt(0);
function dn(e, t, n, r) {
	let i = {
		base: BigInt(0),
		inheriting: BigInt(0)
	};
	if (r === 0) throw new K("Unknown file type", 28);
	switch (r) {
		case 4:
			i.base = nn, i.inheriting = rn;
			break;
		case 3:
			i.base = an, i.inheriting = on;
			break;
		case 6:
		case 5:
			i.base = sn, i.inheriting = cn;
			break;
		case 2:
			e.indexOf(t) === -1 ? (i.base = en, i.inheriting = tn) : (i.base = ln, i.inheriting = un);
			break;
		case 1:
			i.base = Qt, i.inheriting = $t;
			break;
		default: i.base = BigInt(0), i.inheriting = BigInt(0);
	}
	let a = n & 3;
	return a === 0 ? i.base &= ~G.FD_WRITE : a === 1 && (i.base &= ~G.FD_READ), i;
}
function fn(e, t) {
	let n = 0;
	if (typeof t == "number" && t >= 0) n = t;
	else for (let t = 0; t < e.length; t++) {
		let r = e[t];
		n += r.length;
	}
	let r = 0, i = new Uint8Array(n);
	for (let t = 0; t < e.length; t++) {
		let n = e[t];
		i.set(n, r), r += n.length;
	}
	return i;
}
var pn = class {
	constructor(e, t, n, r, i, a, o, s) {
		this.id = e, this.fd = t, this.path = n, this.realPath = r, this.type = i, this.rightsBase = a, this.rightsInheriting = o, this.preopen = s, this.pos = BigInt(0), this.size = BigInt(0);
	}
	seek(e, t) {
		if (t === 0) this.pos = BigInt(e);
		else if (t === 1) this.pos += BigInt(e);
		else if (t === 2) this.pos = BigInt(this.size) - BigInt(e);
		else throw new K("Unknown whence", 29);
		return this.pos;
	}
}, mn = class extends pn {
	constructor(e, t, n, r, i, a, o, s, c) {
		super(t, n, r, i, a, o, s, c), this._log = e, this._buf = null;
	}
	write(e) {
		let t = e;
		if (this._buf &&= (e = fn([this._buf, e]), null), e.indexOf(10) === -1) return this._buf = e, t.byteLength;
		let n = 0, r = 0, i;
		for (; (i = e.indexOf(10, n)) !== -1;) {
			let t = new TextDecoder().decode(e.subarray(r, i));
			this._log(t), n += i - r + 1, r = i + 1;
		}
		return n < e.length && (this._buf = e.slice(n)), t.byteLength;
	}
};
function hn(e) {
	return e.isBlockDevice() ? 1 : e.isCharacterDevice() ? 2 : e.isDirectory() ? 3 : e.isSocket() ? 6 : e.isFile() ? 4 : e.isSymbolicLink() ? 7 : 0;
}
function gn(e, t, n) {
	e.setBigUint64(t, n.dev, !0), e.setBigUint64(t + 8, n.ino, !0), e.setBigUint64(t + 16, BigInt(hn(n)), !0), e.setBigUint64(t + 24, n.nlink, !0), e.setBigUint64(t + 32, n.size, !0), e.setBigUint64(t + 40, n.atimeMs * BigInt(1e6), !0), e.setBigUint64(t + 48, n.mtimeMs * BigInt(1e6), !0), e.setBigUint64(t + 56, n.ctimeMs * BigInt(1e6), !0);
}
var _n = class {
	constructor(e) {
		this.used = 0, this.size = e.size, this.fds = Array(e.size), this.stdio = [
			e.in,
			e.out,
			e.err
		], this.print = e.print, this.printErr = e.printErr, this.insertStdio(e.in, 0, "<stdin>"), this.insertStdio(e.out, 1, "<stdout>"), this.insertStdio(e.err, 2, "<stderr>");
	}
	insertStdio(e, t, n) {
		let { base: r, inheriting: i } = dn(this.stdio, e, 2, 2), a = this.insert(e, n, n, 2, r, i, 0);
		if (a.id !== t) throw new K(`id: ${a.id} !== expected: ${t}`, 8);
		return a;
	}
	insert(e, t, n, r, i, a, o) {
		let s = -1;
		if (this.used >= this.size) {
			let e = this.size * 2;
			this.fds.length = e, s = this.size, this.size = e;
		} else for (let e = 0; e < this.size; ++e) if (this.fds[e] == null) {
			s = e;
			break;
		}
		let c;
		return c = t === "<stdout>" ? new mn(this.print ?? console.log, s, e, t, n, r, i, a, o) : t === "<stderr>" ? new mn(this.printErr ?? console.error, s, e, t, n, r, i, a, o) : new pn(s, e, t, n, r, i, a, o), this.fds[s] = c, this.used++, c;
	}
	get(e, t, n) {
		if (e >= this.size) throw new K("Invalid fd", 8);
		let r = this.fds[e];
		if (!r || r.id !== e) throw new K("Bad file descriptor", 8);
		if ((~r.rightsBase & t) !== BigInt(0) || (~r.rightsInheriting & n) !== BigInt(0)) throw new K("Capabilities insufficient", 76);
		return r;
	}
	remove(e) {
		if (e >= this.size) throw new K("Invalid fd", 8);
		let t = this.fds[e];
		if (!t || t.id !== e) throw new K("Bad file descriptor", 8);
		this.fds[e] = void 0, this.used--;
	}
}, vn = class extends _n {
	constructor(e) {
		super(e), this.fs = e.fs;
	}
	getFileTypeByFd(e) {
		return hn(this.fs.fstatSync(e, { bigint: !0 }));
	}
	insertPreopen(e, t, n) {
		let r = this.getFileTypeByFd(e);
		if (r !== 3) throw new K(`Preopen not dir: ["${t}", "${n}"]`, 54);
		let i = dn(this.stdio, e, 0, r);
		return this.insert(e, t, n, r, i.base, i.inheriting, 1);
	}
	renumber(e, t) {
		if (e === t) return;
		if (e >= this.size || t >= this.size) throw new K("Invalid fd", 8);
		let n = this.fds[e], r = this.fds[t];
		if (!n || !r || n.id !== e || r.id !== t) throw new K("Invalid fd", 8);
		this.fs.closeSync(n.fd), this.fds[e] = this.fds[t], this.fds[e].id = e, this.fds[t] = void 0, this.used--;
	}
}, yn = class extends _n {
	constructor(e) {
		super(e);
	}
	async getFileTypeByFd(e) {
		return hn(await e.stat({ bigint: !0 }));
	}
	async insertPreopen(e, t, n) {
		let r = await this.getFileTypeByFd(e);
		if (r !== 3) throw new K(`Preopen not dir: ["${t}", "${n}"]`, 54);
		let i = dn(this.stdio, e.fd, 0, r);
		return this.insert(e, t, n, r, i.base, i.inheriting, 1);
	}
	async renumber(e, t) {
		if (e === t) return;
		if (e >= this.size || t >= this.size) throw new K("Invalid fd", 8);
		let n = this.fds[e], r = this.fds[t];
		if (!n || !r || n.id !== e || r.id !== t) throw new K("Invalid fd", 8);
		await n.fd.close(), this.fds[e] = this.fds[t], this.fds[e].id = e, this.fds[t] = void 0, this.used--;
	}
}, bn = /*#__PURE__*/ (function() {
	return Ot.Memory;
})(), xn = class extends bn {
	constructor(e) {
		super(e);
	}
	get HEAP8() {
		return new Int8Array(super.buffer);
	}
	get HEAPU8() {
		return new Uint8Array(super.buffer);
	}
	get HEAP16() {
		return new Int16Array(super.buffer);
	}
	get HEAPU16() {
		return new Uint16Array(super.buffer);
	}
	get HEAP32() {
		return new Int32Array(super.buffer);
	}
	get HEAPU32() {
		return new Uint32Array(super.buffer);
	}
	get HEAP64() {
		return new BigInt64Array(super.buffer);
	}
	get HEAPU64() {
		return new BigUint64Array(super.buffer);
	}
	get HEAPF32() {
		return new Float32Array(super.buffer);
	}
	get HEAPF64() {
		return new Float64Array(super.buffer);
	}
	get view() {
		return new DataView(super.buffer);
	}
};
function Sn(e) {
	return Object.getPrototypeOf(e) === Ot.Memory.prototype && Object.setPrototypeOf(e, xn.prototype), e;
}
function Cn() {
	let e = Ot.Function;
	if (typeof e != "function") throw Error("WebAssembly.Function is not supported in this environment. If you are using V8 based browser like Chrome, try to specify --js-flags=\"--wasm-staging --experimental-wasm-stack-switching\"");
	return e;
}
function wn(e, t, n) {
	let r = Cn();
	if (typeof e != "function") throw TypeError("Function required");
	let i = t.slice(0);
	return i.unshift("externref"), new r({
		parameters: i,
		results: n
	}, e, { suspending: "first" });
}
var Tn = typeof process < "u" && process.platform === "win32";
function En(e) {
	let t = e & 3;
	return e & 64 && (t |= 256), e & 128 && (t |= 1024), e & 512 && (t |= 512), e & 1024 && (t |= 8), t;
}
function Dn(e, t) {
	if (e.length === 0 || t.length === 0) return 0;
	let n = 0, r = t.length - n;
	for (let i = 0; i < e.length; ++i) {
		let a = e[i];
		if (r < a.length) return a.set(t.subarray(n, n + r), 0), n += r, r = 0, n;
		a.set(t.subarray(n, n + a.length), 0), n += a.length, r -= a.length;
	}
	return n;
}
var On = /* @__PURE__ */ new WeakMap(), q = /* @__PURE__ */ new WeakMap(), kn = /* @__PURE__ */ new WeakMap();
function An(e, t) {
	let n = e.buffer;
	return t > n.byteLength && (e.grow(0), n = e.buffer), n;
}
function J(e, t = 0) {
	let n = On.get(e);
	return An(n, t), n;
}
function Y(e) {
	let t = kn.get(e);
	if (!t) throw Error("filesystem is unavailable");
	return t;
}
function jn(e) {
	if (e instanceof K) return e.errno;
	switch (e.code) {
		case "ENOENT": return 44;
		case "EBADF": return 8;
		case "EINVAL": return 28;
		case "EPERM": return 63;
		case "EPROTO": return 65;
		case "EEXIST": return 20;
		case "ENOTDIR": return 54;
		case "EMFILE": return 33;
		case "EACCES": return 2;
		case "EISDIR": return 31;
		case "ENOTEMPTY": return 55;
		case "ENOSYS": return 52;
	}
	throw e;
}
function Mn(e, t) {
	return Object.defineProperty(t, "name", { value: e }), t;
}
function Nn(e, t, n) {
	let r;
	try {
		r = e.apply(t, n);
	} catch (e) {
		return jn(e);
	}
	return Ft(r) ? r.then((e) => e, jn) : r;
}
function X(e, t, n) {
	let r = !1, i = (() => {
		try {
			return process.env.NODE_DEBUG_NATIVE;
		} catch {
			return;
		}
	})();
	return typeof i == "string" && i.split(",").includes("wasi") && (r = !0), r ? Mn(t, function() {
		let r = Array.prototype.slice.call(arguments), i = [`${t}(${Array.from({ length: arguments.length }).map(() => "%d").join(", ")})`];
		return i = i.concat(r), console.debug.apply(console, i), Nn(n, e, r);
	}) : Mn(t, function() {
		return Nn(n, e, arguments);
	});
}
function Pn(e, t, n, r) {
	let i = W(t.realPath, n);
	if ((r & 1) == 1) try {
		i = e.readlinkSync(i);
	} catch (e) {
		if (e.code !== "EINVAL" && e.code !== "ENOENT") throw e;
	}
	return i;
}
async function Fn(e, t, n, r) {
	let i = W(t.realPath, n);
	if ((r & 1) == 1) try {
		i = await e.promises.readlink(i);
	} catch (e) {
		if (e.code !== "EINVAL" && e.code !== "ENOENT") throw e;
	}
	return i;
}
var Z = /*#__PURE__*/ new TextEncoder(), Q = /*#__PURE__*/ new TextDecoder(), In = (BigInt(1) << BigInt(63)) - BigInt(1);
function Ln() {
	let e = window.prompt();
	return e === null ? /* @__PURE__ */ new Uint8Array() : new TextEncoder().encode(e + "\n");
}
function Rn(e) {
	return !!(e & -16) || (e & 3) == 3 || (e & 12) == 12;
}
var zn = class e {
	constructor(e, t, n, r, i, a) {
		this.args_get = X(this, "args_get", function(e, t) {
			if (e = Number(e), t = Number(t), e === 0 || t === 0) return 28;
			let n = q.get(this).args, r = Z.encode(n.join("\0") + "\0").length, { HEAPU8: i, view: a } = J(this, Math.max(e + n.length * 4, t + r));
			for (let r = 0; r < n.length; ++r) {
				let o = n[r];
				a.setInt32(e, t, !0), e += 4;
				let s = Z.encode(o + "\0");
				i.set(s, t), t += s.length;
			}
			return 0;
		}), this.args_sizes_get = X(this, "args_sizes_get", function(e, t) {
			if (e = Number(e), t = Number(t), e === 0 || t === 0) return 28;
			let { view: n } = J(this, Math.max(e + 4, t + 4)), r = q.get(this).args;
			return n.setUint32(e, r.length, !0), n.setUint32(t, Z.encode(r.join("\0") + "\0").length, !0), 0;
		}), this.environ_get = X(this, "environ_get", function(e, t) {
			if (e = Number(e), t = Number(t), e === 0 || t === 0) return 28;
			let n = q.get(this).env, r = Z.encode(n.join("\0") + "\0").length, { HEAPU8: i, view: a } = J(this, Math.max(e + n.length * 4, t + r));
			for (let r = 0; r < n.length; ++r) {
				let o = n[r];
				a.setInt32(e, t, !0), e += 4;
				let s = Z.encode(o + "\0");
				i.set(s, t), t += s.length;
			}
			return 0;
		}), this.environ_sizes_get = X(this, "environ_sizes_get", function(e, t) {
			if (e = Number(e), t = Number(t), e === 0 || t === 0) return 28;
			let { view: n } = J(this, Math.max(e + 4, t + 4)), r = q.get(this);
			return n.setUint32(e, r.env.length, !0), n.setUint32(t, Z.encode(r.env.join("\0") + "\0").length, !0), 0;
		}), this.clock_res_get = X(this, "clock_res_get", function(e, t) {
			if (t = Number(t), t === 0) return 28;
			let { view: n } = J(this, t + 8);
			switch (e) {
				case 0: return n.setBigUint64(t, BigInt(1e6), !0), 0;
				case 1:
				case 2:
				case 3: return n.setBigUint64(t, BigInt(1e3), !0), 0;
				default: return 28;
			}
		}), this.clock_time_get = X(this, "clock_time_get", function(e, t, n) {
			if (n = Number(n), n === 0) return 28;
			let { view: r } = J(this, n + 8);
			switch (e) {
				case 0: return r.setBigUint64(n, BigInt(Date.now()) * BigInt(1e6), !0), 0;
				case 1:
				case 2:
				case 3: {
					let e = performance.now() / 1e3, t = Math.trunc(e), i = Math.floor((e - t) * 1e3), a = BigInt(t) * BigInt(1e9) + BigInt(i) * BigInt(1e6);
					return r.setBigUint64(n, a, !0), 0;
				}
				default: return 28;
			}
		}), this.fd_advise = X(this, "fd_advise", function(e, t, n, r) {
			return 52;
		}), this.fd_fdstat_get = X(this, "fd_fdstat_get", function(e, t) {
			if (t = Number(t), t === 0) return 28;
			let n = q.get(this).fds.get(e, BigInt(0), BigInt(0)), { view: r } = J(this, t + 24);
			return r.setUint16(t, n.type, !0), r.setUint16(t + 2, 0, !0), r.setBigUint64(t + 8, n.rightsBase, !0), r.setBigUint64(t + 16, n.rightsInheriting, !0), 0;
		}), this.fd_fdstat_set_flags = X(this, "fd_fdstat_set_flags", function(e, t) {
			return 52;
		}), this.fd_fdstat_set_rights = X(this, "fd_fdstat_set_rights", function(e, t, n) {
			let r = q.get(this).fds.get(e, BigInt(0), BigInt(0));
			return (t | r.rightsBase) > r.rightsBase || (n | r.rightsInheriting) > r.rightsInheriting ? 76 : (r.rightsBase = t, r.rightsInheriting = n, 0);
		}), this.fd_prestat_get = X(this, "fd_prestat_get", function(e, t) {
			if (t = Number(t), t === 0) return 28;
			let n = q.get(this), r;
			try {
				r = n.fds.get(e, BigInt(0), BigInt(0));
			} catch (e) {
				if (e instanceof K) return e.errno;
				throw e;
			}
			if (r.preopen !== 1) return 28;
			let { view: i } = J(this, t + 8);
			return i.setUint32(t, 0, !0), i.setUint32(t + 4, Z.encode(r.path).length, !0), 0;
		}), this.fd_prestat_dir_name = X(this, "fd_prestat_dir_name", function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let r = q.get(this).fds.get(e, BigInt(0), BigInt(0));
			if (r.preopen !== 1) return 8;
			let i = Z.encode(r.path), a = i.length;
			if (a > n) return 42;
			let { HEAPU8: o } = J(this, t + a);
			return o.set(i, t), 0;
		}), this.fd_seek = X(this, "fd_seek", function(e, t, n, r) {
			if (r = Number(r), r === 0) return 28;
			if (e === 0 || e === 1 || e === 2) return 0;
			let i = q.get(this).fds.get(e, G.FD_SEEK, BigInt(0)).seek(t, n), { view: a } = J(this, r + 8);
			return a.setBigUint64(r, i, !0), 0;
		}), this.fd_tell = X(this, "fd_tell", function(e, t) {
			let n = q.get(this).fds.get(e, G.FD_TELL, BigInt(0)), r = BigInt(n.pos), { view: i } = J(this, Number(t) + 8);
			return i.setBigUint64(Number(t), r, !0), 0;
		}), this.poll_oneoff = X(this, "poll_oneoff", function(e, t, n, r) {
			if (e = Number(e), t = Number(t), r = Number(r), n = Number(n), n >>>= 0, e === 0 || t === 0 || n === 0 || r === 0) return 28;
			let { view: i } = J(this, Math.max(e + n * 48, t + n * 32, r + 4));
			i.setUint32(r, 0, !0);
			let a = 0, o = BigInt(0), s = BigInt(0), c = 0, l = BigInt(0), u, d = Array(n);
			for (a = 0; a < n; a++) {
				u = e + a * 48;
				let t = i.getBigUint64(u, !0), n = i.getUint8(u + 8), r = i.getUint32(u + 16, !0), o = i.getBigUint64(u + 24, !0), s = i.getBigUint64(u + 32, !0), c = i.getUint16(u + 40, !0);
				d[a] = {
					userdata: t,
					type: n,
					u: {
						clock: {
							clock_id: r,
							timeout: o,
							precision: s,
							flags: c
						},
						fd_readwrite: { fd: r }
					}
				};
			}
			let f = [];
			for (a = 0; a < n; a++) switch (u = d[a], u.type) {
				case 0:
					if (u.u.clock.flags === 1) {
						let e = BigInt(Date.now()) * BigInt(1e6);
						s = u.u.clock.timeout - e;
					} else s = u.u.clock.timeout;
					(c === 0 || s < l) && (l = s, o = u.userdata, c = 1);
					break;
				case 1:
				case 2:
					f.push(u);
					break;
				default: return 28;
			}
			if (f.length > 0) {
				for (a = 0; a < f.length; a++) {
					let e = f[a], n = t + 32 * a;
					i.setBigUint64(n, e.userdata, !0), i.setUint32(n + 8, 52, !0), i.setUint32(n + 12, e.type, !0), i.setBigUint64(n + 16, BigInt(0), !0), i.setUint16(n + 24, 0, !0), i.setUint32(r, 1, !0);
				}
				return i.setUint32(r, f.length, !0), 0;
			}
			if (c) {
				It(Number(l / BigInt(1e6)), () => !1);
				let e = t;
				i.setBigUint64(e, o, !0), i.setUint32(e + 8, 0, !0), i.setUint32(e + 12, 0, !0), i.setUint32(r, 1, !0);
			}
			return 0;
		}), this.proc_exit = X(this, "proc_exit", function(e) {
			return typeof process == "object" && process !== null && typeof process.exit == "function" && process.exit(e), 0;
		}), this.proc_raise = X(this, "proc_raise", function(e) {
			return 52;
		}), this.sched_yield = X(this, "sched_yield", function() {
			return 0;
		}), this.random_get = typeof crypto < "u" && typeof crypto.getRandomValues == "function" ? X(this, "random_get", function(e, t) {
			if (e = Number(e), e === 0) return 28;
			t = Number(t);
			let { HEAPU8: n, view: r } = J(this, e + t);
			if (typeof SharedArrayBuffer == "function" && n.buffer instanceof SharedArrayBuffer || Object.prototype.toString.call(n.buffer) === "[object SharedArrayBuffer]") {
				for (let n = e; n < e + t; ++n) r.setUint8(n, Math.floor(Math.random() * 256));
				return 0;
			}
			let i, a = 65536;
			for (i = 0; i + a < t; i += a) crypto.getRandomValues(n.subarray(e + i, e + i + a));
			return crypto.getRandomValues(n.subarray(e + i, e + t)), 0;
		}) : X(this, "random_get", function(e, t) {
			if (e = Number(e), e === 0) return 28;
			t = Number(t);
			let { view: n } = J(this, e + t);
			for (let r = e; r < e + t; ++r) n.setUint8(r, Math.floor(Math.random() * 256));
			return 0;
		}), this.sock_recv = X(this, "sock_recv", function() {
			return 58;
		}), this.sock_send = X(this, "sock_send", function() {
			return 58;
		}), this.sock_shutdown = X(this, "sock_shutdown", function() {
			return 58;
		}), this.sock_accept = X(this, "sock_accept", function() {
			return 58;
		}), q.set(this, {
			fds: n,
			args: e,
			env: t
		}), i && kn.set(this, i);
		let o = this;
		function s(e, t, n, i, s) {
			r ? a ? o[e] = a.wrapImportFunction(X(o, e, n)) : o[e] = wn(X(o, e, n), i, s) : o[e] = X(o, e, t);
		}
		s("fd_allocate", function(e, t, n) {
			let r = q.get(this), i = Y(this), a = r.fds.get(e, G.FD_ALLOCATE, BigInt(0));
			return i.fstatSync(a.fd, { bigint: !0 }).size < t + n && i.ftruncateSync(a.fd, Number(t + n)), 0;
		}, async function(e, t, n) {
			let r = q.get(this).fds.get(e, G.FD_ALLOCATE, BigInt(0)).fd;
			return (await r.stat({ bigint: !0 })).size < t + n && await r.truncate(Number(t + n)), 0;
		}, [
			"i32",
			"i64",
			"f64"
		], ["i32"]), s("fd_close", function(e) {
			let t = q.get(this), n = t.fds.get(e, BigInt(0), BigInt(0));
			return Y(this).closeSync(n.fd), t.fds.remove(e), 0;
		}, async function(e) {
			let t = q.get(this);
			return await t.fds.get(e, BigInt(0), BigInt(0)).fd.close(), t.fds.remove(e), 0;
		}, ["i32"], ["i32"]), s("fd_datasync", function(e) {
			let t = q.get(this).fds.get(e, G.FD_DATASYNC, BigInt(0));
			return Y(this).fdatasyncSync(t.fd), 0;
		}, async function(e) {
			return await q.get(this).fds.get(e, G.FD_DATASYNC, BigInt(0)).fd.datasync(), 0;
		}, ["i32"], ["i32"]), s("fd_filestat_get", function(e, t) {
			if (t = Number(t), t === 0) return 28;
			let n = q.get(this).fds.get(e, G.FD_FILESTAT_GET, BigInt(0)), r = Y(this).fstatSync(n.fd, { bigint: !0 }), { view: i } = J(this, t + 64);
			return gn(i, t, r), 0;
		}, async function(e, t) {
			if (t = Number(t), t === 0) return 28;
			let n = await q.get(this).fds.get(e, G.FD_FILESTAT_GET, BigInt(0)).fd.stat({ bigint: !0 }), { view: r } = J(this, t + 64);
			return gn(r, t, n), 0;
		}, ["i32", "i32"], ["i32"]), s("fd_filestat_set_size", function(e, t) {
			let n = q.get(this).fds.get(e, G.FD_FILESTAT_SET_SIZE, BigInt(0));
			return Y(this).ftruncateSync(n.fd, Number(t)), 0;
		}, async function(e, t) {
			return await q.get(this).fds.get(e, G.FD_FILESTAT_SET_SIZE, BigInt(0)).fd.truncate(Number(t)), 0;
		}, ["i32", "i64"], ["i32"]);
		function c(e, t, n, r) {
			let i = q.get(this).fds.get(e, G.FD_FILESTAT_SET_TIMES, BigInt(0));
			return (r & 2) == 2 && (t = BigInt(Date.now() * 1e6)), (r & 8) == 8 && (n = BigInt(Date.now() * 1e6)), {
				fileDescriptor: i,
				atim: t,
				mtim: n
			};
		}
		s("fd_filestat_set_times", function(e, t, n, r) {
			if (Rn(r)) return 28;
			let { fileDescriptor: i, atim: a, mtim: o } = c.call(this, e, t, n, r);
			return Y(this).futimesSync(i.fd, Number(a), Number(o)), 0;
		}, async function(e, t, n, r) {
			if (Rn(r)) return 28;
			let { fileDescriptor: i, atim: a, mtim: o } = c.call(this, e, t, n, r);
			return await i.fd.utimes(Number(a), Number(o)), 0;
		}, [
			"i32",
			"i64",
			"i64",
			"i32"
		], ["i32"]), s("fd_pread", function(e, t, n, r, i) {
			if (t = Number(t), i = Number(i), t === 0 && n || i === 0 || r > In) return 28;
			let { HEAPU8: a, view: o } = J(this, Math.max(t + Number(n) * 8, i + 4)), s = q.get(this).fds.get(e, G.FD_READ | G.FD_SEEK, BigInt(0));
			if (!n) return o.setUint32(i, 0, !0), 0;
			let c = 0, l = Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, i = o.getInt32(r, !0), s = o.getUint32(r + 4, !0);
				return c += s, a.subarray(i, i + s);
			}), u = 0, d = (() => {
				try {
					return new Uint8Array(new SharedArrayBuffer(c));
				} catch {
					return new Uint8Array(c);
				}
			})();
			d._isBuffer = !0;
			let f = Y(this).readSync(s.fd, d, 0, d.length, Number(r));
			return u = d ? Dn(l, d.subarray(0, f)) : 0, o.setUint32(i, u, !0), 0;
		}, async function(e, t, n, r, i) {
			if (t = Number(t), i = Number(i), t === 0 && n || i === 0 || r > In) return 28;
			let { HEAPU8: a, view: o } = J(this, Math.max(t + Number(n) * 8, i + 4)), s = q.get(this).fds.get(e, G.FD_READ | G.FD_SEEK, BigInt(0));
			if (!n) return o.setUint32(i, 0, !0), 0;
			let c = 0, l = Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, i = o.getInt32(r, !0), s = o.getUint32(r + 4, !0);
				return c += s, a.subarray(i, i + s);
			}), u = 0, d = new Uint8Array(c);
			d._isBuffer = !0;
			let { bytesRead: f } = await s.fd.read(d, 0, d.length, Number(r));
			return u = d ? Dn(l, d.subarray(0, f)) : 0, o.setUint32(i, u, !0), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i64",
			"i32"
		], ["i32"]), s("fd_pwrite", function(e, t, n, r, i) {
			if (t = Number(t), i = Number(i), t === 0 && n || i === 0 || r > In) return 28;
			let { HEAPU8: a, view: o } = J(this, Math.max(t + Number(n) * 8, i + 4)), s = q.get(this).fds.get(e, G.FD_WRITE | G.FD_SEEK, BigInt(0));
			if (!n) return o.setUint32(i, 0, !0), 0;
			let c = fn(Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, i = o.getInt32(r, !0), s = o.getUint32(r + 4, !0);
				return a.subarray(i, i + s);
			})), l = Y(this).writeSync(s.fd, c, 0, c.length, Number(r));
			return o.setUint32(i, l, !0), 0;
		}, async function(e, t, n, r, i) {
			if (t = Number(t), i = Number(i), t === 0 && n || i === 0 || r > In) return 28;
			let { HEAPU8: a, view: o } = J(this, Math.max(t + Number(n) * 8, i + 4)), s = q.get(this).fds.get(e, G.FD_WRITE | G.FD_SEEK, BigInt(0));
			if (!n) return o.setUint32(i, 0, !0), 0;
			let c = fn(Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, i = o.getInt32(r, !0), s = o.getUint32(r + 4, !0);
				return a.subarray(i, i + s);
			})), { bytesWritten: l } = await s.fd.write(c, 0, c.length, Number(r));
			return o.setUint32(i, l, !0), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i64",
			"i32"
		], ["i32"]), s("fd_read", function(e, t, n, r) {
			if (t = Number(t), r = Number(r), t === 0 && n || r === 0) return 28;
			let { HEAPU8: i, view: a } = J(this, Math.max(t + Number(n) * 8, r + 4)), o = q.get(this).fds.get(e, G.FD_READ, BigInt(0));
			if (!n) return a.setUint32(r, 0, !0), 0;
			let s = 0, c = Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, o = a.getInt32(r, !0), c = a.getUint32(r + 4, !0);
				return s += c, i.subarray(o, o + c);
			}), l, u = 0;
			if (e === 0) {
				if (typeof window > "u" || typeof window.prompt != "function") return 58;
				l = Ln(), u = l ? Dn(c, l) : 0;
			} else {
				l = (() => {
					try {
						return new Uint8Array(new SharedArrayBuffer(s));
					} catch {
						return new Uint8Array(s);
					}
				})(), l._isBuffer = !0;
				let e = Y(this).readSync(o.fd, l, 0, l.length, Number(o.pos));
				u = l ? Dn(c, l.subarray(0, e)) : 0, o.pos += BigInt(u);
			}
			return a.setUint32(r, u, !0), 0;
		}, async function(e, t, n, r) {
			if (t = Number(t), r = Number(r), t === 0 && n || r === 0) return 28;
			let { HEAPU8: i, view: a } = J(this, Math.max(t + Number(n) * 8, r + 4)), o = q.get(this).fds.get(e, G.FD_READ, BigInt(0));
			if (!n) return a.setUint32(r, 0, !0), 0;
			let s = 0, c = Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, o = a.getInt32(r, !0), c = a.getUint32(r + 4, !0);
				return s += c, i.subarray(o, o + c);
			}), l, u = 0;
			if (e === 0) {
				if (typeof window > "u" || typeof window.prompt != "function") return 58;
				l = Ln(), u = l ? Dn(c, l) : 0;
			} else {
				l = new Uint8Array(s), l._isBuffer = !0;
				let { bytesRead: e } = await o.fd.read(l, 0, l.length, Number(o.pos));
				u = l ? Dn(c, l.subarray(0, e)) : 0, o.pos += BigInt(u);
			}
			return a.setUint32(r, u, !0), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("fd_readdir", function(e, t, n, r, i) {
			if (t = Number(t), n = Number(n), i = Number(i), t === 0 || i === 0) return 0;
			let a = q.get(this).fds.get(e, G.FD_READDIR, BigInt(0)), o = Y(this), s = o.readdirSync(a.realPath, { withFileTypes: !0 }), { HEAPU8: c, view: l } = J(this, Math.max(t + n, i + 4)), u = 0;
			for (let e = Number(r); e < s.length; e++) {
				let r = Z.encode(s[e].name), i = o.statSync(W(a.realPath, s[e].name), { bigint: !0 }), l = new Uint8Array(24 + r.byteLength), d = new DataView(l.buffer);
				d.setBigUint64(0, BigInt(e + 1), !0), d.setBigUint64(8, BigInt(i.ino ? i.ino : 0), !0), d.setUint32(16, r.byteLength, !0);
				let f;
				f = s[e].isFile() ? 4 : s[e].isDirectory() ? 3 : s[e].isSymbolicLink() ? 7 : s[e].isCharacterDevice() ? 2 : s[e].isBlockDevice() ? 1 : s[e].isSocket() ? 6 : 0, d.setUint8(20, f), l.set(r, 24);
				let p = l.slice(0, Math.min(l.length, n - u));
				c.set(p, t + u), u += p.byteLength;
			}
			return l.setUint32(i, u, !0), 0;
		}, async function(e, t, n, r, i) {
			if (t = Number(t), n = Number(n), i = Number(i), t === 0 || i === 0) return 0;
			let a = q.get(this).fds.get(e, G.FD_READDIR, BigInt(0)), o = Y(this), s = await o.promises.readdir(a.realPath, { withFileTypes: !0 }), { HEAPU8: c, view: l } = J(this, Math.max(t + n, i + 4)), u = 0;
			for (let e = Number(r); e < s.length; e++) {
				let r = Z.encode(s[e].name), i = await o.promises.stat(W(a.realPath, s[e].name), { bigint: !0 }), l = new Uint8Array(24 + r.byteLength), d = new DataView(l.buffer);
				d.setBigUint64(0, BigInt(e + 1), !0), d.setBigUint64(8, BigInt(i.ino ? i.ino : 0), !0), d.setUint32(16, r.byteLength, !0);
				let f;
				f = s[e].isFile() ? 4 : s[e].isDirectory() ? 3 : s[e].isSymbolicLink() ? 7 : s[e].isCharacterDevice() ? 2 : s[e].isBlockDevice() ? 1 : s[e].isSocket() ? 6 : 0, d.setUint8(20, f), l.set(r, 24);
				let p = l.slice(0, Math.min(l.length, n - u));
				c.set(p, t + u), u += p.byteLength;
			}
			return l.setUint32(i, u, !0), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i64",
			"i32"
		], ["i32"]), s("fd_renumber", function(e, t) {
			return q.get(this).fds.renumber(t, e), 0;
		}, async function(e, t) {
			return await q.get(this).fds.renumber(t, e), 0;
		}, ["i32", "i32"], ["i32"]), s("fd_sync", function(e) {
			let t = q.get(this).fds.get(e, G.FD_SYNC, BigInt(0));
			return Y(this).fsyncSync(t.fd), 0;
		}, async function(e) {
			return await q.get(this).fds.get(e, G.FD_SYNC, BigInt(0)).fd.sync(), 0;
		}, ["i32"], ["i32"]), s("fd_write", function(e, t, n, r) {
			if (t = Number(t), r = Number(r), t === 0 && n || r === 0) return 28;
			let { HEAPU8: i, view: a } = J(this, Math.max(t + Number(n) * 8, r + 4)), o = q.get(this).fds.get(e, G.FD_WRITE, BigInt(0));
			if (!n) return a.setUint32(r, 0, !0), 0;
			let s = fn(Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, o = a.getInt32(r, !0), s = a.getUint32(r + 4, !0);
				return i.subarray(o, o + s);
			})), c;
			return e === 1 || e === 2 ? c = o.write(s) : (c = Y(this).writeSync(o.fd, s, 0, s.length, Number(o.pos)), o.pos += BigInt(c)), a.setUint32(r, c, !0), 0;
		}, async function(e, t, n, r) {
			if (t = Number(t), r = Number(r), t === 0 && n || r === 0) return 28;
			let { HEAPU8: i, view: a } = J(this, Math.max(t + Number(n) * 8, r + 4)), o = q.get(this).fds.get(e, G.FD_WRITE, BigInt(0));
			if (!n) return a.setUint32(r, 0, !0), 0;
			let s = fn(Array.from({ length: Number(n) }, (e, n) => {
				let r = t + n * 8, o = a.getInt32(r, !0), s = a.getUint32(r + 4, !0);
				return i.subarray(o, o + s);
			})), c;
			return e === 1 || e === 2 ? c = o.write(s) : (c = await (await o.fd.write(s, 0, s.length, Number(o.pos))).bytesWritten, o.pos += BigInt(c)), a.setUint32(r, c, !0), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_create_directory", function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let { HEAPU8: r } = J(this, t + n), i = q.get(this).fds.get(e, G.PATH_CREATE_DIRECTORY, BigInt(0)), a = Q.decode(H(r, t, t + n));
			return a = W(i.realPath, a), Y(this).mkdirSync(a), 0;
		}, async function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let { HEAPU8: r } = J(this, t + n), i = q.get(this).fds.get(e, G.PATH_CREATE_DIRECTORY, BigInt(0)), a = Q.decode(H(r, t, t + n));
			return a = W(i.realPath, a), await Y(this).promises.mkdir(a), 0;
		}, [
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_filestat_get", function(e, t, n, r, i) {
			if (n = Number(n), r = Number(r), i = Number(i), n === 0 || i === 0) return 28;
			let { HEAPU8: a, view: o } = J(this, Math.max(n + r, i + 64)), s = q.get(this).fds.get(e, G.PATH_FILESTAT_GET, BigInt(0)), c = Q.decode(H(a, n, n + r)), l = Y(this);
			c = W(s.realPath, c);
			let u;
			return u = (t & 1) == 1 ? l.statSync(c, { bigint: !0 }) : l.lstatSync(c, { bigint: !0 }), gn(o, i, u), 0;
		}, async function(e, t, n, r, i) {
			if (n = Number(n), r = Number(r), i = Number(i), n === 0 || i === 0) return 28;
			let { HEAPU8: a, view: o } = J(this, Math.max(n + r, i + 64)), s = q.get(this).fds.get(e, G.PATH_FILESTAT_GET, BigInt(0)), c = Q.decode(H(a, n, n + r)), l = Y(this);
			c = W(s.realPath, c);
			let u;
			return u = (t & 1) == 1 ? await l.promises.stat(c, { bigint: !0 }) : await l.promises.lstat(c, { bigint: !0 }), gn(o, i, u), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_filestat_set_times", function(e, t, n, r, i, a, o) {
			if (n = Number(n), r = Number(r), n === 0) return 28;
			let { HEAPU8: s } = J(this, n + r), c = q.get(this).fds.get(e, G.PATH_FILESTAT_SET_TIMES, BigInt(0));
			if (Rn(o)) return 28;
			let l = Y(this), u = Pn(l, c, Q.decode(H(s, n, n + r)), t);
			return (o & 2) == 2 && (i = BigInt(Date.now() * 1e6)), (o & 8) == 8 && (a = BigInt(Date.now() * 1e6)), l.utimesSync(u, Number(i), Number(a)), 0;
		}, async function(e, t, n, r, i, a, o) {
			if (n = Number(n), r = Number(r), n === 0) return 28;
			let { HEAPU8: s } = J(this, n + r), c = q.get(this).fds.get(e, G.PATH_FILESTAT_SET_TIMES, BigInt(0));
			if (Rn(o)) return 28;
			let l = Y(this), u = await Fn(l, c, Q.decode(H(s, n, n + r)), t);
			return (o & 2) == 2 && (i = BigInt(Date.now() * 1e6)), (o & 8) == 8 && (a = BigInt(Date.now() * 1e6)), await l.promises.utimes(u, Number(i), Number(a)), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i64",
			"i64",
			"i32"
		], ["i32"]), s("path_link", function(e, t, n, r, i, a, o) {
			if (n = Number(n), r = Number(r), a = Number(a), o = Number(o), n === 0 || a === 0) return 28;
			let s = q.get(this), c, l;
			e === i ? c = l = s.fds.get(e, G.PATH_LINK_SOURCE | G.PATH_LINK_TARGET, BigInt(0)) : (c = s.fds.get(e, G.PATH_LINK_SOURCE, BigInt(0)), l = s.fds.get(i, G.PATH_LINK_TARGET, BigInt(0)));
			let { HEAPU8: u } = J(this, Math.max(n + r, a + o)), d = Y(this), f = Pn(d, c, Q.decode(H(u, n, n + r)), t), p = W(l.realPath, Q.decode(H(u, a, a + o)));
			return d.linkSync(f, p), 0;
		}, async function(e, t, n, r, i, a, o) {
			if (n = Number(n), r = Number(r), a = Number(a), o = Number(o), n === 0 || a === 0) return 28;
			let s = q.get(this), c, l;
			e === i ? c = l = s.fds.get(e, G.PATH_LINK_SOURCE | G.PATH_LINK_TARGET, BigInt(0)) : (c = s.fds.get(e, G.PATH_LINK_SOURCE, BigInt(0)), l = s.fds.get(i, G.PATH_LINK_TARGET, BigInt(0)));
			let { HEAPU8: u } = J(this, Math.max(n + r, a + o)), d = Y(this), f = await Fn(d, c, Q.decode(H(u, n, n + r)), t), p = W(l.realPath, Q.decode(H(u, a, a + o)));
			return await d.promises.link(f, p), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]);
		function l(e, t, n, r) {
			let i = (t & (G.FD_READ | G.FD_READDIR)) !== BigInt(0), a = (t & (G.FD_DATASYNC | G.FD_WRITE | G.FD_ALLOCATE | G.FD_FILESTAT_SET_SIZE)) !== BigInt(0), o = a ? i ? 2 : 1 : 0, s = G.PATH_OPEN, c = t | n;
			return e & 1 && (o |= 64, s |= G.PATH_CREATE_FILE), e & 2 && (o |= 65536), e & 4 && (o |= 128), e & 8 && (o |= 512, s |= G.PATH_FILESTAT_SET_SIZE), r & 1 && (o |= 1024), r & 2 && (c |= G.FD_DATASYNC), r & 4 && (o |= 2048), r & 8 && (o |= 1052672, c |= G.FD_SYNC), r & 16 && (o |= 1052672, c |= G.FD_SYNC), a && !(o & 1536) && (c |= G.FD_SEEK), {
				flags: o,
				needed_base: s,
				needed_inheriting: c
			};
		}
		s("path_open", function(e, t, n, r, i, a, o, s, c) {
			if (n = Number(n), c = Number(c), n === 0 || c === 0) return 28;
			r = Number(r), a = BigInt(a), o = BigInt(o);
			let { flags: u, needed_base: d, needed_inheriting: f } = l(i, a, o, s), p = q.get(this), m = p.fds.get(e, d, f), h = J(this, Math.max(n + r, c + 4)), g = h.HEAPU8, _ = Q.decode(H(g, n, n + r)), v = Y(this), y = Pn(v, m, _, t), b = v.openSync(y, Tn ? En(u) : u, 438), x = p.fds.getFileTypeByFd(b);
			if (x !== 3 && (i & 2 || y.endsWith("/"))) return 54;
			let { base: S, inheriting: C } = dn(p.fds.stdio, b, u, x), w = p.fds.insert(b, y, y, x, a & S, o & C, 0), T = v.fstatSync(b, { bigint: !0 });
			return T.isFile() && (w.size = T.size, u & 1024 && (w.pos = T.size)), h.view.setInt32(c, w.id, !0), 0;
		}, async function(e, t, n, r, i, a, o, s, c) {
			if (n = Number(n), c = Number(c), n === 0 || c === 0) return 28;
			r = Number(r), a = BigInt(a), o = BigInt(o);
			let { flags: u, needed_base: d, needed_inheriting: f } = l(i, a, o, s), p = q.get(this), m = p.fds.get(e, d, f), h = J(this, Math.max(n + r, c + 4)), g = h.HEAPU8, _ = Q.decode(H(g, n, n + r)), v = Y(this), y = await Fn(v, m, _, t), b = await v.promises.open(y, Tn ? En(u) : u, 438), x = await p.fds.getFileTypeByFd(b);
			if (i & 2 && x !== 3) return 54;
			let { base: S, inheriting: C } = dn(p.fds.stdio, b.fd, u, x), w = p.fds.insert(b, y, y, x, a & S, o & C, 0), T = await b.stat({ bigint: !0 });
			return T.isFile() && (w.size = T.size, u & 1024 && (w.pos = T.size)), h.view.setInt32(c, w.id, !0), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i32",
			"i64",
			"i64",
			"i32",
			"i32"
		], ["i32"]), s("path_readlink", function(e, t, n, r, i, a) {
			if (t = Number(t), n = Number(n), r = Number(r), i = Number(i), a = Number(a), t === 0 || r === 0 || a === 0) return 28;
			let { HEAPU8: o, view: s } = J(this, Math.max(t + n, r + i, a + 4)), c = q.get(this).fds.get(e, G.PATH_READLINK, BigInt(0)), l = Q.decode(H(o, t, t + n));
			l = W(c.realPath, l);
			let u = Y(this).readlinkSync(l), d = Z.encode(u), f = Math.min(d.length, i);
			return f >= i ? 42 : (o.set(d.subarray(0, f), r), o[r + f] = 0, s.setUint32(a, f, !0), 0);
		}, async function(e, t, n, r, i, a) {
			if (t = Number(t), n = Number(n), r = Number(r), i = Number(i), a = Number(a), t === 0 || r === 0 || a === 0) return 28;
			let { HEAPU8: o, view: s } = J(this, Math.max(t + n, r + i, a + 4)), c = q.get(this).fds.get(e, G.PATH_READLINK, BigInt(0)), l = Q.decode(H(o, t, t + n));
			l = W(c.realPath, l);
			let u = await Y(this).promises.readlink(l), d = Z.encode(u), f = Math.min(d.length, i);
			return f >= i ? 42 : (o.set(d.subarray(0, f), r), o[r + f] = 0, s.setUint32(a, f, !0), 0);
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_remove_directory", function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let { HEAPU8: r } = J(this, t + n), i = q.get(this).fds.get(e, G.PATH_REMOVE_DIRECTORY, BigInt(0)), a = Q.decode(H(r, t, t + n));
			return a = W(i.realPath, a), Y(this).rmdirSync(a), 0;
		}, async function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let { HEAPU8: r } = J(this, t + n), i = q.get(this).fds.get(e, G.PATH_REMOVE_DIRECTORY, BigInt(0)), a = Q.decode(H(r, t, t + n));
			return a = W(i.realPath, a), await Y(this).promises.rmdir(a), 0;
		}, [
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_rename", function(e, t, n, r, i, a) {
			if (t = Number(t), n = Number(n), i = Number(i), a = Number(a), t === 0 || i === 0) return 28;
			let o = q.get(this), s, c;
			e === r ? s = c = o.fds.get(e, G.PATH_RENAME_SOURCE | G.PATH_RENAME_TARGET, BigInt(0)) : (s = o.fds.get(e, G.PATH_RENAME_SOURCE, BigInt(0)), c = o.fds.get(r, G.PATH_RENAME_TARGET, BigInt(0)));
			let { HEAPU8: l } = J(this, Math.max(t + n, i + a)), u = W(s.realPath, Q.decode(H(l, t, t + n))), d = W(c.realPath, Q.decode(H(l, i, i + a)));
			return Y(this).renameSync(u, d), 0;
		}, async function(e, t, n, r, i, a) {
			if (t = Number(t), n = Number(n), i = Number(i), a = Number(a), t === 0 || i === 0) return 28;
			let o = q.get(this), s, c;
			e === r ? s = c = o.fds.get(e, G.PATH_RENAME_SOURCE | G.PATH_RENAME_TARGET, BigInt(0)) : (s = o.fds.get(e, G.PATH_RENAME_SOURCE, BigInt(0)), c = o.fds.get(r, G.PATH_RENAME_TARGET, BigInt(0)));
			let { HEAPU8: l } = J(this, Math.max(t + n, i + a)), u = W(s.realPath, Q.decode(H(l, t, t + n))), d = W(c.realPath, Q.decode(H(l, i, i + a)));
			return await Y(this).promises.rename(u, d), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_symlink", function(e, t, n, r, i) {
			if (e = Number(e), t = Number(t), r = Number(r), i = Number(i), e === 0 || r === 0) return 28;
			let { HEAPU8: a } = J(this, Math.max(e + t, r + i)), o = q.get(this).fds.get(n, G.PATH_SYMLINK, BigInt(0)), s = Q.decode(H(a, e, e + t));
			if (s.length > 0 && s[0] === "/") return 63;
			let c = Q.decode(H(a, r, r + i));
			return c = W(o.realPath, c), Y(this).symlinkSync(s, c), 0;
		}, async function(e, t, n, r, i) {
			if (e = Number(e), t = Number(t), r = Number(r), i = Number(i), e === 0 || r === 0) return 28;
			let { HEAPU8: a } = J(this, Math.max(e + t, r + i)), o = q.get(this).fds.get(n, G.PATH_SYMLINK, BigInt(0)), s = Q.decode(H(a, e, e + t)), c = Q.decode(H(a, r, r + i));
			return c = W(o.realPath, c), await Y(this).promises.symlink(s, c), 0;
		}, [
			"i32",
			"i32",
			"i32",
			"i32",
			"i32"
		], ["i32"]), s("path_unlink_file", function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let { HEAPU8: r } = J(this, t + n), i = q.get(this).fds.get(e, G.PATH_UNLINK_FILE, BigInt(0)), a = Q.decode(H(r, t, t + n));
			return a = W(i.realPath, a), Y(this).unlinkSync(a), 0;
		}, async function(e, t, n) {
			if (t = Number(t), n = Number(n), t === 0) return 28;
			let { HEAPU8: r } = J(this, t + n), i = q.get(this).fds.get(e, G.PATH_UNLINK_FILE, BigInt(0)), a = Q.decode(H(r, t, t + n));
			return a = W(i.realPath, a), await Y(this).promises.unlink(a), 0;
		}, [
			"i32",
			"i32",
			"i32"
		], ["i32"]), this._setMemory = function(e) {
			if (!(e instanceof Ot.Memory)) throw TypeError("\"instance.exports.memory\" property must be a WebAssembly.Memory");
			On.set(o, Sn(e));
		};
	}
	static createSync(t, n, r, i, a, o, s) {
		let c = new vn({
			size: 3,
			in: i[0],
			out: i[1],
			err: i[2],
			fs: a,
			print: o,
			printErr: s
		}), l = new e(t, n, c, !1, a);
		if (r.length > 0) for (let e = 0; e < r.length; ++e) {
			let t = a.realpathSync(r[e].realPath, "utf8"), n = a.openSync(t, "r", 438);
			c.insertPreopen(n, r[e].mappedPath, t);
		}
		return l;
	}
	static async createAsync(t, n, r, i, a, o, s, c) {
		let l = new yn({
			size: 3,
			in: i[0],
			out: i[1],
			err: i[2],
			print: o,
			printErr: s
		}), u = new e(t, n, l, !0, a, c);
		if (r.length > 0) for (let e = 0; e < r.length; ++e) {
			let t = r[e], n = await a.promises.realpath(t.realPath), i = await a.promises.open(n, "r", 438);
			await l.insertPreopen(i, t.mappedPath, n);
		}
		return u;
	}
}, Bn = /*#__PURE__*/ Object.freeze(/*#__PURE__*/ Object.create(null)), Vn = Symbol("kExitCode"), Hn = Symbol("kSetMemory"), Un = Symbol("kStarted"), Wn = Symbol("kInstance"), Gn = Symbol("kBindingName");
function Kn(e) {
	kt(e, "options");
	let t;
	if (e.version !== void 0) switch (Mt(e.version, "options.version"), e.version) {
		case "unstable":
			t = zn, this[Gn] = "wasi_unstable";
			break;
		case "preview1":
			t = zn, this[Gn] = "wasi_snapshot_preview1";
			break;
		default: throw TypeError(`unsupported WASI version "${e.version}"`);
	}
	else t = zn, this[Gn] = "wasi_snapshot_preview1";
	e.args !== void 0 && At(e.args, "options.args");
	let n = (e.args ?? []).map(String), r = [];
	e.env !== void 0 && (kt(e.env, "options.env"), Object.entries(e.env).forEach(({ 0: e, 1: t }) => {
		t !== void 0 && r.push(`${e}=${t}`);
	}));
	let i = [];
	if (e.preopens !== void 0 && (kt(e.preopens, "options.preopens"), Object.entries(e.preopens).forEach(({ 0: e, 1: t }) => i.push({
		mappedPath: String(e),
		realPath: String(t)
	}))), i.length > 0) {
		if (e.fs === void 0) throw Error("filesystem is disabled, can not preopen directory");
		try {
			kt(e.fs, "options.fs");
		} catch {
			throw TypeError("Node.js fs like implementation is not provided");
		}
	}
	return e.print !== void 0 && Nt(e.print, "options.print"), e.printErr !== void 0 && Nt(e.printErr, "options.printErr"), e.returnOnExit !== void 0 && jt(e.returnOnExit, "options.returnOnExit"), {
		args: n,
		env: r,
		preopens: i,
		stdio: [
			0,
			1,
			2
		],
		_WASI: t
	};
}
function qn(e, t) {
	this[Hn] = e, this.wasiImport = t, this[Un] = !1, this[Vn] = 0, this[Wn] = void 0;
}
var Jn = class {
	constructor(e = Bn) {
		let { args: t, env: n, preopens: r, stdio: i, _WASI: a } = Kn.call(this, e), o = a.createSync(t, n, r, i, e.fs, e.print, e.printErr), s = o._setMemory;
		delete o._setMemory, qn.call(this, s, o), e.returnOnExit && (o.proc_exit = Yn.bind(this));
	}
	finalizeBindings(e, t) {
		var { memory: n = e?.exports?.memory } = t === void 0 ? {} : t;
		if (this[Un]) throw Error("WASI instance has already started");
		kt(e, "instance"), kt(e.exports, "instance.exports"), this[Hn](n), this[Wn] = e, this[Un] = !0;
	}
	start(e) {
		this.finalizeBindings(e);
		let { _start: t, _initialize: n } = this[Wn].exports;
		Nt(t, "instance.exports._start"), Pt(n, "instance.exports._initialize");
		let r;
		try {
			r = t();
		} catch (e) {
			if (e !== Vn) throw e;
		}
		return r instanceof Promise ? r.then(() => this[Vn], (e) => {
			if (e !== Vn) throw e;
			return this[Vn];
		}) : this[Vn];
	}
	initialize(e) {
		this.finalizeBindings(e);
		let { _start: t, _initialize: n } = this[Wn].exports;
		if (Pt(t, "instance.exports._start"), n !== void 0) return Nt(n, "instance.exports._initialize"), n();
	}
	getImportObject() {
		return { [this[Gn]]: this.wasiImport };
	}
};
function Yn(e) {
	throw this[Vn] = e, Vn;
}
//#endregion
//#region ../../node_modules/@napi-rs/wasm-runtime/runtime.js
var { instantiateNapiModuleSync: Xn, instantiateNapiModule: Zn, MessageHandler: Qn } = A, { createContext: $n, getDefaultContext: er } = _e, tr = Object.freeze({
	initialPages: 1024,
	maximumPages: 65536,
	pageBytes: 65536,
	initialBytes: 67108864,
	maximumBytes: 4294967296
}), nr = 0, rr = 0, ir = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get, ar = Object.getOwnPropertyDescriptor(WebAssembly.Memory.prototype, "buffer").get, or = /* @__PURE__ */ new WeakSet();
function sr(e) {
	let t = e?.memory;
	if (t == null) {
		let t = new WebAssembly.Memory({
			initial: e != null && e.initialMemoryPages !== void 0 ? e.initialMemoryPages : tr.initialPages,
			maximum: e != null && e.maximumMemoryPages !== void 0 ? e.maximumMemoryPages : tr.maximumPages
		});
		return or.add(t), t;
	}
	if (e.initialMemoryPages !== void 0 || e.maximumMemoryPages !== void 0) throw TypeError("Pass either memory or initialMemoryPages/maximumMemoryPages, not both");
	let n;
	try {
		n = Reflect.apply(ar, t, []);
	} catch {
		throw TypeError("memory must be an unshared WebAssembly.Memory");
	}
	try {
		Reflect.apply(ir, n, []);
	} catch {
		throw TypeError("The deferred loader requires an unshared WebAssembly.Memory");
	}
	if (!(t instanceof WebAssembly.Memory)) throw TypeError("memory must be a WebAssembly.Memory created in the same realm as this loader");
	if (or.has(t)) throw TypeError("This WebAssembly.Memory has already been used for a deferred initialization attempt and cannot be reused, including after a failed initialization or a disposal");
	return or.add(t), t;
}
var cr = "wasm32-wasip1";
function lr(e, t) {
	if (Object.prototype.hasOwnProperty.call(e, "__napiBindingTarget")) {
		if (e.__napiBindingTarget === t) return t;
		let n = /* @__PURE__ */ Error("`__napiBindingTarget` is reserved by the generated binding loader, but the loaded binding already exports it. Rename the export, e.g. #[napi(js_name = \"...\")].");
		throw n.code = "ERR_NAPI_BINDING_TARGET_CONFLICT", n;
	}
	if (!Object.isExtensible(e)) return t;
	try {
		Object.defineProperty(e, "__napiBindingTarget", {
			configurable: !0,
			enumerable: !0,
			value: t,
			writable: !0
		});
	} catch {}
	return t;
}
async function ur(e) {
	let t = await e;
	try {
		WebAssembly.Module.imports(t);
	} catch {
		throw TypeError("instantiate() and createInstance() expect a precompiled WebAssembly.Module (or a Promise resolving to one), e.g. import mod from './fsrs-binding.wasm32-wasip1.wasm' under a CompiledWasm module rule / wrangler module import. Byte buffers, URLs and Response objects require dynamic Wasm compilation, which Cloudflare Workers disallows.");
	}
	return t;
}
var dr;
function fr(e, t) {
	return dr ||= /* @__PURE__ */ new WeakMap(), dr.set(e, t), t;
}
async function pr(e) {
	if (e instanceof WebAssembly.Module) return e;
	if (dr) {
		let t = dr.get(e);
		if (t) return t;
	}
	if (typeof structuredClone == "function") try {
		let t = structuredClone(e);
		if (t instanceof WebAssembly.Module) return fr(e, t);
	} catch {}
	if (typeof MessageChannel == "function") {
		let t;
		try {
			t = new MessageChannel();
			let n = await new Promise((n, r) => {
				t.port1.onmessage = (e) => n(e.data), t.port1.onmessageerror = () => r(/* @__PURE__ */ TypeError("Failed to clone WebAssembly.Module"));
				try {
					t.port2.postMessage(e);
				} catch (e) {
					r(e);
				}
			});
			if (n instanceof WebAssembly.Module) return fr(e, n);
		} catch {} finally {
			try {
				t?.port1.close();
			} catch {}
			try {
				t?.port2.close();
			} catch {}
		}
	}
	try {
		Object.setPrototypeOf(e, WebAssembly.Module.prototype);
	} catch {}
	if (e instanceof WebAssembly.Module) return e;
	throw TypeError("This host cannot normalize a cross-realm WebAssembly.Module; provide structuredClone or MessageChannel support.");
}
function mr(e, t, n) {
	let r;
	try {
		r = e.destroy;
	} catch {
		return e;
	}
	if (typeof r != "function") return e;
	try {
		Object.defineProperty(e, "destroy", {
			configurable: !0,
			enumerable: !1,
			writable: !0,
			value: function() {
				if (!n?.()) return t?.(), Reflect.apply(r, this, arguments);
			}
		});
	} catch {}
	return e;
}
function hr(e) {
	if (!e || typeof e.prependListener != "function" || typeof e.removeListener != "function") return;
	let t, n = (e, n) => {
		e === "beforeExit" && t === void 0 && (t = n);
	};
	try {
		e.prependListener("newListener", n);
	} catch {
		return;
	}
	return () => {
		try {
			e.removeListener("newListener", n);
		} catch {}
		if (t !== void 0) try {
			e.removeListener("beforeExit", t);
		} catch {}
	};
}
function gr(e, t) {
	try {
		e && (typeof e == "object" || typeof e == "function") && e.cause === void 0 && (e.cause = t);
	} catch {}
}
var _r = (function() {
	if (typeof setImmediate == "function") return function(e) {
		setImmediate(e);
	};
	let e = globalThis.MessageChannel;
	return typeof e == "function" ? function(t) {
		let n = new e();
		n.port1.onmessage = function() {
			n.port1.onmessage = null;
			try {
				n.port1.close();
			} catch {}
			try {
				n.port2.close();
			} catch {}
			t();
		}, n.port2.postMessage(null);
	} : function(e) {
		setTimeout(e, 0);
	};
})(), vr = 128, yr = 4;
function br(e) {
	let t = e?.exports.napi_wasm_env_cleanup_pending, n = typeof t == "function";
	if (n) {
		let e;
		try {
			e = t();
		} catch {
			return;
		}
		if (!e) return;
	}
	let r = n ? vr : yr;
	return (async () => {
		let e = 0;
		for (let i = 0; i < r; i++) if (await new Promise((e) => {
			_r(e);
		}), n) {
			try {
				e = t();
			} catch {
				return;
			}
			if (!e) return;
		}
		if (!n) return;
		let i = /* @__PURE__ */ Error("the wasm environment still reports " + e + " queued settlement(s) after " + r + " event-loop turns; the context was not destroyed - retry dispose() to wait for the queue again");
		throw i.code = "ERR_NAPI_WASI_CLEANUP_PENDING", i;
	})();
}
function xr(e, t) {
	let n = globalThis.setTimeout;
	if (typeof n != "function") _r(e);
	else try {
		n(e, t);
	} catch {
		_r(e);
	}
}
var Sr = 1, Cr = 2, wr = 50, Tr = 200;
function Er() {
	return {
		arrivals: 0,
		settleTurn: void 0,
		turnTimerDueAt: 0
	};
}
function Dr(e) {
	let t = globalThis.setTimeout;
	if (typeof t != "function") return;
	let n = Date.now() + Tr, r;
	try {
		r = t(() => {
			let t = e.settleTurn;
			!t || e.turnTimerDueAt > n - wr || (e.arrivals = 0, e.settleTurn = void 0, t());
		}, Tr);
	} catch {
		return;
	}
	if (r && typeof r.unref == "function") try {
		r.unref();
	} catch {}
}
function Or(e) {
	return Dr(e), new Promise((t) => {
		let n = !1, r = () => {
			n || (n = !0, e.settleTurn === r && (e.settleTurn = void 0), t());
		};
		xr(() => {
			e.arrivals++, r();
		}, Sr);
		let i = Date.now() + Sr;
		e.arrivals < Cr ? _r(r) : (e.settleTurn = r, e.turnTimerDueAt = i);
	});
}
async function kr(e) {
	let t = Er();
	for (;;) {
		await Or(t);
		try {
			if (!e()) return;
		} catch {
			return;
		}
	}
}
var Ar = 1;
function jr(e) {
	let t = e?.exports, n = t?.napi_wasm_async_work_pending, r = t?.napi_wasm_cancel_pending_async_work;
	if (typeof n != "function" || typeof r != "function") return;
	let i = () => {
		try {
			return n();
		} catch (e) {
			if (e instanceof globalThis.WebAssembly.RuntimeError) return 0;
			throw e;
		}
	};
	if (i()) {
		try {
			r();
		} catch {}
		if (i()) return (async () => {
			for (; i();) await new Promise((e) => {
				xr(e, Ar);
			});
		})();
	}
}
function Mr(e) {
	let t = /* @__PURE__ */ Error(e + "() cannot run while an emnapi Context.destroy() call is still active; await the original cleanup promise instead.");
	return t.code = "ERR_NAPI_WASI_LIFECYCLE_REENTRY", t;
}
var Nr = /* @__PURE__ */ new Set(), Pr, Fr, Ir, Lr = 0, Rr = !1, zr = 0;
function Br() {
	let e = Pr, t = Fr;
	if (Pr = void 0, Fr = void 0, Lr = 0, e && t) try {
		e.removeListener("beforeExit", t);
	} catch {}
}
function Vr() {
	!Pr || Fr || Nr.size === 0 || Rr || Lr >= 3 || (Rr = !0, Lr++, queueMicrotask(() => {
		if (Rr = !1, Pr && !Fr && Nr.size !== 0) try {
			Hr();
		} catch {}
	}));
}
function Hr() {
	if (Pr && !Fr) {
		try {
			Pr.once("beforeExit", Gr);
		} catch (e) {
			throw Vr(), e;
		}
		Fr = Gr, Lr = 0;
	}
}
function Ur(e) {
	if (Ir === e && (Ir = void 0), Nr.size === 0) Br();
	else try {
		Hr();
	} catch {}
}
function Wr(e) {
	if (Ir) return Ir;
	let t = Array.from(Nr).filter((t) => !e?.has(t));
	if (t.length === 0) return Promise.resolve();
	let n, r, i = new Promise((e, t) => {
		n = e, r = t;
	});
	return Ir = i, new Set(t), Promise.all(t.map((e) => {
		try {
			return Promise.resolve(e()).then(() => ({ failed: !1 }), (e) => ({
				failed: !0,
				error: e
			}));
		} catch (e) {
			return {
				failed: !0,
				error: e
			};
		}
	})).then((e) => {
		let t, i = !1;
		for (let n of e) n.failed && (i ? gr(t, n.error) : (i = !0, t = n.error));
		i ? r(t) : n();
	}, r), i.then(() => {
		Ur(i);
	}, () => {
		Ur(i);
	}), i;
}
function Gr() {
	Fr = void 0, !Ir && Wr().catch((e) => {
		queueMicrotask(() => {
			throw e;
		});
	});
}
function Kr(e, t) {
	Nr.add(t), !Pr && e && typeof e.once == "function" && typeof e.removeListener == "function" && (Pr = e);
	let n = !0;
	return () => {
		n && (n = !1, Nr.delete(t), Nr.size === 0 && Br());
	};
}
async function qr(e, t) {
	let n = typeof process == "object" && process !== null ? process : void 0, r = hr(n), i, a, o = !1;
	try {
		i = mr(wt({ autoDestroy: !1 }), e, t), i.suppressDestroy();
	} catch (e) {
		a = e, o = !0;
	} finally {
		r?.();
	}
	if (i === void 0) throw a;
	let s = !1, c = !1, l, u = !1, d, f = (n = !1) => {
		if (s) return;
		if (c) throw Mr("dispose");
		if (l) return l;
		c = !0;
		let r, a = () => {
			c = !1;
		}, o = () => {
			n && (n = !1, zr--);
		};
		n && zr++;
		try {
			if (e?.(), t?.()) throw Mr("dispose");
			r = i.destroy();
		} catch (e) {
			throw a(), o(), e;
		}
		let u;
		try {
			r !== null && (typeof r == "object" || typeof r == "function") && (u = r.then);
		} catch (e) {
			throw a(), o(), e;
		}
		if (typeof u == "function") {
			let e, t, n = new Promise((n, r) => {
				e = n, t = r;
			}).then((e) => (a(), o(), s = !0, l = void 0, d?.(), e), (e) => {
				throw a(), o(), l = void 0, e;
			});
			l = n;
			try {
				Reflect.apply(u, r, [e, t]);
			} catch (e) {
				t(e);
			}
			return n;
		}
		a(), o(), s = !0, d?.();
	}, p = () => f(!0), m = (e = p) => {
		u || s || (d = Kr(n, e), u = !0, Hr());
	};
	if (o) {
		let e, t = !1;
		try {
			m();
		} catch (n) {
			gr(a, n), e = n, t = !0;
		}
		try {
			await p();
		} catch (n) {
			gr(t ? e : a, n);
			try {
				Hr();
			} catch {}
		}
		throw a;
	}
	return {
		context: i,
		destroy: f,
		destroyForModuleLifecycle: p,
		registerCleanup: m
	};
}
async function Jr(e, t, n, r) {
	let i = await pr(await ur(e)), a = new Jn({ version: "preview1" }), o = sr(t), s = "pending", c, l, u, d, f = !1, p = !1, m = !1, h, g = !1, _ = !1, v = !1, y, b = () => m, x = () => {
		if (g || _) return;
		let e = d?.exports.napi_wasm_env_cleanup_pending;
		if (typeof e != "function") return;
		let t;
		try {
			t = e();
		} catch {
			return;
		}
		if (t) {
			_ = !0;
			try {
				let e = globalThis.console;
				e && typeof e.error == "function" && e.error("napi-rs: the wasm environment is being destroyed with " + t + " queued promise settlement(s). Context.destroy() discards them, so those promises never settle. Dispose the instance instead: only dispose() yields the event-loop turns the settlements need.");
			} catch {}
		}
	}, S = () => {
		if (p) return;
		let e = h;
		if (e !== void 0) {
			e(), x();
			return;
		}
		if (m) return;
		let t = d?.exports.napi_prepare_wasm_env_cleanup;
		if (typeof t == "function") {
			m = !0;
			try {
				t();
			} finally {
				m = !1;
			}
			f = !0, x();
		}
		p = !0;
	}, C = () => {
		if (p || m) return;
		let e = d?.exports, t = e?.napi_prepare_wasm_env_cleanup_begin, n = e?.napi_prepare_wasm_env_cleanup_finish;
		if (typeof t != "function" || typeof n != "function") {
			g = !0;
			try {
				S();
			} finally {
				g = !1;
			}
			return;
		}
		let r = e?.napi_wasm_runtime_work_pending;
		m = !0;
		let i;
		try {
			i = t();
		} catch (e) {
			throw m = !1, e;
		}
		f = !0;
		let a = () => {
			if (!p) {
				h = void 0;
				try {
					n();
				} finally {
					m = !1;
				}
				p = !0;
			}
		};
		if (!i || typeof r != "function") a();
		else return h = a, kr(r).then(a, a);
	}, w = () => {
		if (!f) return;
		let e = br(d);
		if (!e || typeof e.then != "function") v = !0;
		else return e.then((e) => (v = !0, e));
	}, T = () => {
		if (v) return;
		if (y) return y;
		let e = C(), t = e && typeof e.then == "function" ? e.then(w) : w();
		if (!t || typeof t.then != "function") return;
		let n = t.then((e) => (y = void 0, e), (e) => {
			throw y = void 0, e;
		});
		return y = n, n;
	}, E = !1, ee = async () => {
		s !== "failed" && (s = "disposal");
		let e = jr(d);
		e && await e;
		let t = T();
		t && await t;
		let r = await (n ? u() : l());
		return E || (E = !0, --rr), r;
	}, D, O = () => {
		if (D) return D;
		let e, t, n = new Promise((n, r) => {
			e = n, t = r;
		});
		return D = n, ee().then(e, (e) => {
			D = void 0, t(e);
		}), n;
	}, te = n ? async () => {
		if (s === "failed") await u();
		else {
			s = "disposal";
			try {
				await n();
			} catch (e) {
				if (s !== "failed") throw e;
				await u();
			}
		}
	} : void 0, { context: k, destroy: A, destroyForModuleLifecycle: j, registerCleanup: M } = await qr(S, b);
	c = A, l = () => c(), u = j;
	try {
		te && (r(te), await M(te));
		let e;
		return {instance: d, napiModule: e} = await Zn(i, {
			context: k,
			asyncWorkPoolSize: 0,
			plugins: [Et, Dt],
			wasi: a,
			overwriteImports(e) {
				return e.env = {
					...e.env,
					...e.napi,
					...e.emnapi,
					memory: o
				}, e;
			},
			beforeInit({ instance: e }) {
				d = e;
				for (let t of Object.keys(e.exports)) t.startsWith("__napi_register__") && e.exports[t]();
			}
		}), lr(e.exports, cr), s === "pending" && (s = "succeeded"), nr += 1, rr += 1, {
			exports: e.exports,
			get memory() {
				return o;
			},
			get memoryBytes() {
				return E ? 0 : o.buffer.byteLength;
			},
			get disposed() {
				return E;
			},
			dispose: O
		};
	} catch (e) {
		s = "failed";
		let t = !1;
		try {
			let e = jr(d);
			e && await e;
			let t = T();
			t && await t;
		} catch (n) {
			gr(e, n), t = !0;
		}
		let r, i = !1;
		if (!n) try {
			await M();
		} catch (t) {
			gr(e, t), r = t, i = !0;
		}
		if (t) {
			try {
				Hr();
			} catch {}
			throw e;
		}
		try {
			await u();
		} catch (t) {
			gr(i ? r : e, t);
			try {
				Hr();
			} catch {}
		}
		throw e;
	}
}
async function Yr(e, t) {
	return Jr(e, t);
}
//#endregion
//#region src/training.ts
var Xr = "@open-spaced-repetition/binding-wasm32-wasip1@0.6.0", Zr = Object.freeze({
	histories: 2e4,
	reviews: 1e5,
	items: 5e4,
	prefixReviews: 2e6,
	historyReviews: 1024
});
function $(e) {
	if (e.modelVersion !== "FSRS-6") throw Error("unsupported-model");
	let t = Date.parse(e.cutoff);
	if (!Number.isFinite(t) || e.histories.length > Zr.histories) throw Error("invalid-training-history");
	let n = 0, r = 0, i = [];
	for (let a of e.histories) {
		let e = a.ratings.length;
		if (!e || e !== a.elapsedDays.length || e !== a.reviewedAt.length || a.elapsedDays[0] !== 0 || e > Zr.historyReviews) throw Error("invalid-training-history");
		if (n += e, n > Zr.reviews) throw Error("training-limit");
		let o = -Infinity;
		for (let n = 0; n < e; n++) {
			let e = Date.parse(a.reviewedAt[n]), s = a.ratings[n], c = a.elapsedDays[n];
			if (!Number.isFinite(e) || e < o || !Number.isInteger(s) || s < 1 || s > 4 || !Number.isInteger(c) || c < 0 || c > 36500) throw Error("invalid-training-history");
			if (o = e, !(n === 0 || e >= t || c === 0)) {
				if (r += n + 1, r > Zr.prefixReviews || i.length >= Zr.items) throw Error("training-limit");
				i.push({
					ratings: a.ratings.slice(0, n + 1),
					elapsedDays: a.elapsedDays.slice(0, n + 1)
				});
			}
		}
	}
	if (i.length < 512) throw Error("insufficient-training-history");
	return i;
}
async function Qr(e, t, n) {
	let r = $(t).map(({ ratings: t, elapsedDays: n }) => new e.FSRSBindingItem(t.map((t, r) => new e.FSRSBindingReview(t, n[r])))), i = await e.computeParameters(r, {
		modelVersion: "FSRS-6",
		enableShortTerm: t.enableShortTerm,
		numRelearningSteps: 1,
		trainingConfig: {
			numEpochs: 5,
			batchSize: 512,
			seed: 2026,
			maxSeqLen: Zr.historyReviews,
			learningRate: .04,
			gamma: 1
		},
		progress: n
	});
	if (i.length !== 21 || i.some((e) => !Number.isFinite(e))) throw Error("invalid-trained-parameters");
	return {
		weights: i,
		engine: Xr
	};
}
//#endregion
//#region src/optimizer.worker.ts
var $r = !1;
self.onmessage = async (e) => {
	if ($r) return;
	$r = !0;
	let t;
	try {
		let { wasm: n, input: r } = e.data;
		if (!(n instanceof ArrayBuffer) || !n.byteLength || n.byteLength > 4194304) throw Error("optimizer-asset-invalid");
		t = await Yr(await WebAssembly.compile(n), {
			initialMemoryPages: 1024,
			maximumMemoryPages: 8192
		});
		let i = await Qr(t.exports, r, (e, t) => self.postMessage({
			type: "progress",
			current: e,
			total: t
		}));
		self.postMessage({
			type: "result",
			...i
		});
	} catch (e) {
		self.postMessage({
			type: "error",
			code: e instanceof Error ? e.message : "optimizer-failed"
		});
	} finally {
		await t?.dispose();
	}
};
//#endregion
