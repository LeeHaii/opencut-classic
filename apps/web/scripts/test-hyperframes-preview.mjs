// Real React + sandboxed-iframe regression tests. No saved project is opened.
// HF_TEST_BROWSER=/path/to/chrome node apps/web/scripts/test-hyperframes-preview.mjs
// Uses the existing workspace's Hyperframes CLI browser/build dependencies.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";

const repo = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const require = createRequire(import.meta.url);
function resolvePackage(name) {
	try {
		return require.resolve(name);
	} catch {
		const cache = path.join(repo, "node_modules/.bun");
		for (const entry of readdirSync(cache)) {
			const candidate = path.join(cache, entry, "node_modules", name);
			if (
				entry.startsWith(name.replaceAll("/", "+") + "@") &&
				existsSync(candidate)
			)
				return require.resolve(candidate);
		}
		throw new Error(
			`Install the workspace dependencies before running this test (missing ${name}).`,
		);
	}
}
const puppeteerModule = require(resolvePackage("puppeteer-core"));
const puppeteer = puppeteerModule.default ?? puppeteerModule;
const esbuild = require(resolvePackage("esbuild"));
const sharp = require(resolvePackage("sharp"));
const webRequire = createRequire(path.join(repo, "apps/web/package.json"));
const sourceRoot = repo.replaceAll("\\", "/");
const stubs = {
	"@/animation":
		"export const getElementLocalTime=({timelineTime,elementStartTime,elementDuration})=>Math.max(0,Math.min(elementDuration,timelineTime-elementStartTime));",
	"@/editor/use-editor": "export const useEditor=()=>window.editor;",
	"@/rendering":
		'export const buildTransformFromParams=()=>({position:{x:0,y:0},scaleX:1,scaleY:1,rotate:0});export const readBlendModeFromParams=()=>"normal";export const readOpacityFromParams=()=>1;',
	"@/rendering/animation-values":
		"export const resolveTransformAtTime=({baseTransform})=>baseTransform;",
	"@/wasm": "export const TICKS_PER_SECOND=120000;",
	"lucide-react":
		"export const Hand=()=>null;export const MousePointer2=()=>null;",
	sonner: "export const toast={success(){},error(){},warning(){}};",
	"./studio-document":
		"export const applyStudioLayerPatches=()=>{};export const postStudioPreviewAction=()=>{};export const studioLayerFromPreviewSelection=()=>{};",
	"./studio-animations":
		"export const parseStudioRuntimeMotionSnapshot=()=>null;",
	"./studio-store":
		'const noop=()=>{};const state={tool:"select",setTool:noop,setPreviewIframe:noop,setPreviewSelection:noop,setRuntimeMotion:noop,selectedLayerSelector:null};export const useHyperframesStudioStore=select=>select(state);useHyperframesStudioStore.getState=()=>state;',
	"./use-studio-element": "export const findStudioElement=()=>null;",
	"@/media/image-mime": "export const studioImageFileAsDataUrl=()=>{};",
	"@opencut/hyperframes": `export {preparePreviewHtml,PARENT_MESSAGE_SOURCE,PREVIEW_MESSAGE_SOURCE} from "${sourceRoot}/packages/hyperframes/src/prepare-preview.ts";export const isNative=()=>false;export const nativeInvoke=()=>Promise.reject(Error("unused"));export const quickValidate=()=>null;`,
};
const entry = `
import React,{useState,useEffect,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {getHyperframesPreviewOverlaySource,findHyperframesPreviewElement} from '${sourceRoot}/apps/web/src/hyperframes/preview-overlay.tsx';
import {usePreviewPresentation} from '${sourceRoot}/apps/web/src/hyperframes/use-preview-presentation.ts';
const callbacks={updates:new Set(),seeks:new Set()};
let time=0;
const noop=()=>{};
const playback={getCurrentTime:()=>time,onUpdate:fn=>{callbacks.updates.add(fn);return ()=>callbacks.updates.delete(fn)},onSeek:fn=>{callbacks.seeks.add(fn);return ()=>callbacks.seeks.delete(fn)}};
window.editor={playback,project:{getActiveOrNull:()=>({metadata:{id:'probe'}})},timeline:{getLastFrameTime:()=>15*120000-4000,dragSource:{subscribe:()=>noop,getActive:()=>null}}};
function scene(id,start,color,extra='',delay=0,broken=false){
 const register='window.__timelines={'+id+':{duration:2,seek:function(t){'+(broken?'throw Error("fixture seek failure");':'document.body.style.background="'+color+'";document.body.dataset.frame=t;')+'}}};';
 return {id,name:id,type:'hyperframes',compositionId:id,width:640,height:360,startTime:start*120000,duration:240000,trimStart:0,trimEnd:0,params:{},html:'<html><head><style>html,body{margin:0;width:100%;height:100%}body{background:#000}</style></head><body><div data-composition-id="'+id+'" data-start="0" data-duration="2">'+id+'</div>'+extra+'<script>'+(delay?'setTimeout(function(){'+register+'},'+delay+');':register)+'<\\/script></body></html>'};
}
const initial=[scene('A',1,'#ef4444'),scene('B',3,'#22c55e','',350),scene('C',5,'#3b82f6'),scene('slow',7,'#eab308','<img src="'+location.origin+'/slow.svg">'),scene('broken',9,'#000','',0,true),scene('missing',11,'#000','<img src="'+location.origin+'/missing.png">'),scene('terminal',13,'#06b6d4')];
window.events=[];window.samples=[];window.playing=false;
window.addEventListener('message',event=>window.events.push(event.data));
function Host(){
 const [current,setCurrent]=useState(0),[elements,setElements]=useState(initial);
 const tracks={main:{id:'main',type:'video',elements},overlay:[],audio:[]};
 const previewTime=Math.min(current,window.editor.timeline.getLastFrameTime());
 const desired=findHyperframesPreviewElement({tracks,timelineTime:previewTime});
 const presentation=usePreviewPresentation({desiredElement:desired,scope:'test'});
 const live=useRef(null);
 useLayoutEffect(()=>{live.current={...presentation,current,desired};});
 useEffect(()=>{
   window.move=(value,seek=true)=>{time=value;setCurrent(value);for(const fn of callbacks[seek?'seeks':'updates'])fn(value)};
   window.edit=()=>setElements(old=>old.map(el=>el.id==='A'?{...el,html:el.html.replace('#ef4444','#a855f7')}:el));
   window.stallAssets=()=>setElements(old=>old.map(el=>el.id==='C'?scene('C',5,'#3b82f6','<img src="'+location.origin+'/stalled.svg">'):el));
   window.stallAcknowledgments=()=>setElements(old=>old.map(el=>el.id==='C'?scene('C',5,'#3b82f6','<script>window.requestAnimationFrame=function(){};<\\/script>'):el));
   window.commitObsolete=()=>live.current.onCanvasCommitted(time,'obsolete-document');
   window.play=(from)=>{window.playing=true;window.move(from);let last=performance.now();const step=now=>{if(!window.playing)return;window.move(time+(now-last)*120,false);last=now;requestAnimationFrame(step)};requestAnimationFrame(step)};
   let raf;
   // A controllable canvas commit boundary: GPU/media decoding are outside
   // this integration fixture; the presentation hook and iframe are real.
   const frame=()=>{
     const state=live.current;
     if(!state.canvasCommitSuspended && !window.holdCanvas) {
       document.querySelector('#canvas').style.background=state.desired?'#111111':'#64748b';
       state.onCanvasCommitted(state.current,state.canvasPresentationKey);
     }
     window.samples.push({time,shown:[...document.querySelectorAll('[data-presented="true"]')].map(el=>el.dataset.hyperframesKey),count:document.querySelectorAll('iframe').length});
     raf=requestAnimationFrame(frame);
   };raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);
 },[]);
 const source=getHyperframesPreviewOverlaySource({tracks,timelineTime:previewTime,presentedElement:presentation.presentedElement,projectCanvasSize:{width:640,height:360},onFramePresented:presentation.onReady});
 return <><output id="state">{JSON.stringify({current,suspended:presentation.canvasCommitSuspended,presented:presentation.presentedElement?.id??null})}</output><div id="surface" style={{position:'relative',width:640,height:360}}><div id="canvas" style={{position:'absolute',inset:0,background:'#64748b'}}/>{source.instances.map(instance=><div key={instance.id} style={{position:'absolute',inset:0,zIndex:instance.zIndex}}>{instance.render({sceneWidth:640,sceneHeight:360})}</div>)}</div></>;
}
createRoot(document.querySelector('#root')).render(<React.StrictMode><Host/></React.StrictMode>);
`;
const bundle = await esbuild.build({
	stdin: { contents: entry, loader: "tsx", resolveDir: repo },
	absWorkingDir: repo,
	bundle: true,
	write: false,
	platform: "browser",
	format: "iife",
	jsx: "automatic",
	define: { "process.env.NODE_ENV": '"development"' },
	plugins: [
		{
			name: "editor-service-fixture",
			setup(build) {
				build.onResolve({ filter: /.*/ }, (args) => {
					if (stubs[args.path]) return { path: args.path, namespace: "stub" };
					if (
						[
							"react",
							"react/jsx-runtime",
							"react-dom",
							"react-dom/client",
						].includes(args.path)
					)
						return { path: webRequire.resolve(args.path) };
				});
				build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
					contents: stubs[args.path],
					resolveDir: repo,
				}));
			},
		},
	],
});
const server = http.createServer((request, response) => {
	if (request.url === "/slow.svg" || request.url === "/stalled.svg") {
		setTimeout(
			() => {
				response.writeHead(200, {
					"content-type": "image/svg+xml",
					"access-control-allow-origin": "*",
				});
				response.end(
					'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
				);
			},
			request.url === "/stalled.svg" ? 8800 : 1800,
		);
		return;
	}
	if (request.url === "/missing.png") {
		response.writeHead(404);
		response.end();
		return;
	}
	response.writeHead(200, {
		"content-type": request.url === "/app.js" ? "text/javascript" : "text/html",
	});
	response.end(
		request.url === "/app.js"
			? bundle.outputFiles[0].text
			: '<html><head><style>.absolute{position:absolute}.overflow-hidden{overflow:hidden}.left-1\\/2{left:50%}.top-1\\/2{top:50%}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
	);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browserPath =
	process.env.HF_TEST_BROWSER ??
	(process.platform === "win32"
		? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
		: undefined);
assert(
	browserPath,
	"Set HF_TEST_BROWSER to an installed Chromium/Edge executable.",
);
let browser;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
	browser = await puppeteer.launch({
		executablePath: browserPath,
		headless: true,
		args: [
			"--enable-features=IsolateSandboxedIframes,ProcessPerSiteUpToMainFrameThreshold",
		],
		ignoreDefaultArgs: [
			"--disable-background-timer-throttling",
			"--disable-renderer-backgrounding",
			"--disable-backgrounding-occluded-windows",
		],
	});
	console.log("Browser:", await browser.version());
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewport({ width: 900, height: 600 });
	await page.goto("http://127.0.0.1:" + server.address().port);
	await page.waitForFunction(() => typeof window.move === "function");
	const state = () => page.$eval("#state", (el) => JSON.parse(el.textContent));
	const move = (seconds) =>
		page.evaluate((value) => window.move(value * 120000), seconds);
	const shown = async (id) => {
		await page.waitForFunction(
			(expected) =>
				JSON.parse(document.querySelector("#state").textContent).presented ===
				expected,
			{ timeout: 4000 },
			id,
		);
		assert.equal((await state()).suspended, false);
	};
	const color = async (expected) => {
		const bounds = await page.$eval("#surface", (el) => {
			const r = el.getBoundingClientRect();
			return { x: r.x + 200, y: r.y + 100, width: 1, height: 1 };
		});
		const pixel = await sharp(
			Buffer.from(await page.screenshot({ clip: bounds })),
		)
			.removeAlpha()
			.raw()
			.toBuffer();
		assert.deepEqual([...pixel], expected);
	};
	await move(1.5);
	await shown("A");
	await color([239, 68, 68]);
	console.log("PASS paused entry has actual scene pixels");
	await page.evaluate(() => (window.holdCanvas = true));
	await move(3.5);
	await wait(600);
	assert.equal((await state()).presented, "A");
	await page.evaluate(() => window.commitObsolete());
	assert.equal((await state()).presented, "A");
	await color([239, 68, 68]);
	await page.evaluate(() => (window.holdCanvas = false));
	await shown("B");
	await color([34, 197, 94]);
	console.log("PASS incoming readiness cannot reveal before canvas commit");
	await move(1.5);
	await shown("A");
	const outgoing = await page.$("iframe");
	await move(3.5);
	await wait(20);
	await move(5.5);
	await shown("C");
	await color([59, 130, 246]);
	assert(
		await page.evaluate(() =>
			window.samples.every(
				(sample) => sample.count <= 2 && sample.shown.length <= 1,
			),
		),
	);
	await outgoing.dispose();
	console.log("PASS rapid A -> B -> C retains bounded documents");
	await move(3);
	await shown("B");
	await color([34, 197, 94]);
	await move(5);
	await shown("C");
	await move(7);
	await wait(500);
	assert.equal((await state()).presented, "C");
	assert.equal((await state()).suspended, true);
	await shown("slow");
	await color([234, 179, 8]);
	console.log(
		"PASS exact boundaries and delayed assets preserve outgoing pixels",
	);
	await move(0);
	await shown(null);
	await color([100, 116, 139]);
	await move(1.5);
	await shown("A");
	await color([239, 68, 68]);
	console.log("PASS AI -> normal canvas -> same AI re-entry");
	const oldKey = await page.$eval(
		'[data-presented="true"]',
		(el) => el.dataset.hyperframesKey,
	);
	await page.evaluate(() => window.edit());
	await page.waitForFunction(
		(key) => {
			const shown = document.querySelector('[data-presented="true"]');
			return shown && shown.dataset.hyperframesKey !== key;
		},
		{ timeout: 4000 },
		oldKey,
	);
	await color([168, 85, 247]);
	console.log("PASS editing retains old revision until replacement is ready");
	await move(0);
	await shown(null);
	await page.evaluate(() => window.play(1.01 * 120000));
	await wait(800);
	assert.equal((await state()).presented, "A");
	assert.equal((await state()).suspended, false);
	await wait(1500);
	await shown("B");
	await page.evaluate(() => (window.playing = false));
	console.log("PASS continuous playback enters AI and crosses AI boundary");
	for (const seconds of [1.1, 2.5, 1.8, 2.2, 1.2]) {
		await move(seconds);
		await wait(8);
	}
	await shown("A");
	await wait(150);
	const activeFrame = page
		.frames()
		.find((frame) => frame.url() === "about:srcdoc");
	const applied = await activeFrame.evaluate(() =>
		Number(document.body.dataset.frame),
	);
	assert(
		Math.abs(applied - 0.2) < 0.001,
		`paused seek did not converge: ${applied}`,
	);
	console.log("PASS rapid scrubbing converges after pause");
	await move(9.5);
	await shown("broken");
	assert(
		await page.$eval("#surface", (el) => el.textContent.includes("failed")),
	);
	console.log("PASS throwing scene releases hold into explicit error");
	await move(11.5);
	await shown("missing");
	assert(
		await page.$eval("#surface", (el) => el.textContent.includes("decoded")),
	);
	console.log("PASS missing image is an error, not false readiness");
	await move(5.5);
	await shown("C");
	await color([59, 130, 246]);
	await move(15);
	await shown("terminal");
	await color([6, 182, 212]);
	await wait(300);
	await color([6, 182, 212]);
	console.log("PASS terminal project end holds the final AI frame");
	const other = await browser.newPage();
	await other.bringToFront();
	await move(5.5);
	await wait(250);
	await page.bringToFront();
	await shown("C");
	await color([59, 130, 246]);
	await other.close();
	console.log("PASS background entry recovers on foreground resume");
	await page.evaluate(() => window.stallAssets());
	await page.waitForFunction(
		() =>
			document.querySelector("#surface").textContent.includes("still loading"),
		{ timeout: 10000 },
	);
	assert.equal(
		await page.$eval(
			'[data-presented="true"] iframe',
			(frame) => getComputedStyle(frame).opacity,
		),
		"0",
	);
	await page.waitForFunction(
		() => {
			const frame = document.querySelector('[data-presented="true"] iframe');
			return (
				frame &&
				getComputedStyle(frame).opacity === "1" &&
				!document
					.querySelector("#surface")
					.textContent.includes("still loading")
			);
		},
		{ timeout: 4000 },
	);
	await color([59, 130, 246]);
	console.log(
		"PASS asset timeout is not readiness; late assets recover automatically",
	);
	await page.evaluate(() => window.stallAcknowledgments());
	await page.waitForFunction(
		() =>
			document.querySelector("#surface").textContent.includes("not responding"),
		{ timeout: 13000 },
	);
	assert.equal((await state()).suspended, false);
	await move(13.5);
	await shown("terminal");
	await color([6, 182, 212]);
	console.log(
		"PASS missing acknowledgments cannot silently freeze the canvas forever",
	);
	assert.deepEqual(errors, []);
	console.log("PASS recovery after failed scene; no uncaught browser errors");
} finally {
	if (browser) await browser.close();
	server.close();
}
