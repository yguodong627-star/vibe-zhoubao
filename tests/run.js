// 无头 Chrome 自测（puppeteer-core）。运行：node tests/run.js  需要联网才能验证真实抓取。
const puppeteer=require('/workspace/tools/node_modules/puppeteer-core');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');const OUT=path.join(ROOT,'screenshots');
const types={'.js':'text/javascript','.html':'text/html','.css':'text/css','.ttf':'font/ttf'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end()}r.setHeader('content-type',types[path.extname(f)]||'text/plain');r.end(fs.readFileSync(f))}).listen(8161);
// 模拟 OpenAI 兼容接口（带 CORS），只验证前端调用链路，不代表任何真实服务
let aiBody=null;
const ai=http.createServer((q,r)=>{r.setHeader('access-control-allow-origin','*');r.setHeader('access-control-allow-headers','*');if(q.method==='OPTIONS'){r.statusCode=204;return r.end()}let b='';q.on('data',d=>b+=d);q.on('end',()=>{aiBody={auth:q.headers.authorization,body:JSON.parse(b)};r.setHeader('content-type','application/json');r.end(JSON.stringify({choices:[{message:{content:'这是模拟接口返回的摘要。'}}]}))})}).listen(8162);
let pass=0,fail=0;const results=[];
function ok(c,m){(c?pass++:fail++);results.push((c?'PASS ':'FAIL ')+m);console.log((c?'PASS ':'FAIL ')+m)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const br=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox'],headless:true});
 const ctx=br.defaultBrowserContext();const page=await br.newPage();
 await page.setViewport({width:1440,height:900});
 const dialogs=[];let promptAnswer=null;
 page.on('dialog',async d=>{dialogs.push(d.type()+': '+d.message().slice(0,80));if(d.type()==='prompt')await d.accept(promptAnswer!=null?promptAnswer:d.defaultValue());else await d.accept()});
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.goto('http://localhost:8161/#pool',{waitUntil:'load'});await sleep(500);
 await page.screenshot({path:OUT+'/desktop-1-pool-empty.png'});
 // ---- 纯函数 ----
 const u=await page.evaluate(()=>{const z=window.__zb;return {
  c1:z.canonUrl('http://www.Example.com/a/b/?utm_source=x&b=2&a=1#frag'),c2:z.canonUrl('https://example.com/a/b?a=1&b=2'),bad:z.canonUrl('javascript:alert(1)'),
  links:z.parseLinks('产品周刊第3期\nhttps://a.com/1\n[Foo](https://b.com/x)\n标题B | https://c.com/y?utm_medium=z\nhttps://d.com/only'),
  feedRss:z.parseFeed('<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>A &amp;amp; B</title><link>https://x.com/1</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;hello &lt;b&gt;w&lt;/b&gt;&lt;/p&gt;</description></item></channel></rss>'),
  feedAtom:z.parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>AT</title><entry><title>E1</title><link rel="alternate" href="https://y.com/e1"/><updated>2026-10-10T08:00:00Z</updated><summary>S</summary></entry></feed>'),
  opml:z.parseOpml('<opml><body><outline text="G"><outline text="Feed1" xmlUrl="https://f.com/rss"/></outline></body></opml>')}});
 ok(u.c1===u.c2&&u.c1==='example.com/a/b?a=1&b=2','URL 规范化去追踪参数/www/协议/锚点：'+u.c1);
 ok(u.bad===null,'javascript: 链接被拒绝');
 ok(u.links.length===4&&u.links[0].title==='产品周刊第3期'&&u.links[1].title==='Foo'&&u.links[2].title==='标题B'&&u.links[2].url.startsWith('https://c.com'),'粘贴链接解析（上一行标题/Markdown/竖线）：'+JSON.stringify(u.links.map(x=>x.title)));
 ok(u.feedRss.items.length===1&&u.feedRss.items[0].summary==='hello w'&&u.feedRss.items[0].published===Date.parse('2026-10-12T10:00:00Z'),'RSS 解析（HTML 摘要剥离、日期）');
 ok(u.feedAtom.items.length===1&&u.feedAtom.items[0].url==='https://y.com/e1','Atom 解析');
 ok(u.opml.length===1&&u.opml[0].url==='https://f.com/rss','OPML 解析');
 // ---- 真实抓取：预设源 ----
 await page.goto('http://localhost:8161/#sources');await sleep(300);
 await page.screenshot({path:OUT+'/desktop-2-sources.png',fullPage:true});
 const nPre=await page.$$eval('#presetList button',b=>b.length);
 for(let i=0;i<nPre;i++){await page.evaluate(i=>document.querySelectorAll('#presetList button')[i].click(),i);for(let k=0;k<40;k++){await sleep(1000);const tx=await page.evaluate(i=>document.querySelectorAll('#presetList button')[i].textContent,i);if(tx!=='测试中…')break}}
 const srcs=await page.evaluate(()=>window.__zb.S.sources.map(s=>({n:s.name,st:s.status,m:s.msg})));
 console.log(JSON.stringify(srcs,null,1));
 const live=srcs.filter(s=>s.st==='ok');
 ok(live.length>=6,`预设源浏览器真实抓取成功 ${live.length}/${nPre}：`+live.map(s=>s.n).join('、'));
 const failed=srcs.length<nPre?nPre-srcs.length:0;
 // ---- 不支持跨域的源应如实失败 ----
 const blockedTest=await page.evaluate(async()=>{const r={};for(const u of ['https://www.36kr.com/feed','https://www.theverge.com/rss/index.xml','https://www.woshipm.com/feed','https://www.producttalk.org/feed/','https://www.ifanr.com/feed']){try{await fetch(u);r[u]='可读'}catch(e){r[u]='被拦截:'+e.message}}return r});
 ok(Object.values(blockedTest).every(v=>v.startsWith('被拦截')),'36氪 / The Verge / 人人都是产品经理 / Product Talk / 爱范儿 在浏览器里被 CORS 拦截（如实标注为不支持）：'+JSON.stringify(blockedTest));
 // 通过 UI 添加不支持的源应拒绝
 await page.goto('http://localhost:8161/#sources');await sleep(300);
 const before=await page.evaluate(()=>window.__zb.S.sources.length);
 await page.type('#aUrl','https://www.36kr.com/feed');const d0=dialogs.length;await page.click('#aGo');for(let k=0;k<30&&dialogs.length===d0;k++)await sleep(1000);
 const after=await page.evaluate(()=>window.__zb.S.sources.length);
 ok(after===before&&dialogs.some(d=>d.includes('无法读取')),'UI 添加不支持跨域源：被拒绝并给出原因；对话框：'+dialogs[dialogs.length-1]);
 // ---- 条目池 ----
 await page.goto('http://localhost:8161/#pool');await sleep(500);
 const n=await page.evaluate(()=>Object.keys(window.__zb.S.items).length);
 ok(n>50,'条目池条目数 '+n);
 // 去重：再抓取一次，不应翻倍
 await page.evaluate(()=>document.getElementById('btnRefresh').click());await page.waitForFunction(()=>!document.getElementById('btnRefresh').disabled,{timeout:120000});await sleep(500);
 const n2=await page.evaluate(()=>Object.keys(window.__zb.S.items).length);
 ok(n2-n<=Math.max(5,n*0.1),`再次抓取去重：${n} → ${n2}`);
 const nodup=await page.evaluate(()=>{const c=Object.values(window.__zb.S.items).map(i=>i.canon);return c.length===new Set(c).size});
 ok(nodup,'池内无重复规范化链接');
 await page.evaluate(()=>window.scrollTo(0,document.getElementById('poolSide').getBoundingClientRect().top+scrollY-8));await sleep(200);await page.screenshot({path:OUT+'/desktop-3-pool.png'});
 // 排序与规则
 const top1=await page.evaluate(()=>document.querySelector('.item .i-title').textContent);
 const sorted=await page.evaluate(()=>{const s=[...document.querySelectorAll('.item .score')].map(x=>parseFloat(x.textContent));return s.every((v,i)=>i===0||s[i-1]>=v)});
 ok(sorted,'按得分降序');
 // 展开明细
 await page.click('.item .score');await sleep(100);
 const bd=await page.$eval('.item .bd',e=>e.textContent);ok(/合计/.test(bd)&&/来源分/.test(bd),'得分明细可展开');
 await page.screenshot({path:OUT+'/desktop-4-pool-breakdown.png'});await page.evaluate(()=>window.scrollTo(0,0));
 // 手动：给一个确定关键词大权重，应改变排序
 await page.evaluate(()=>{const z=window.__zb;const t=Object.values(z.S.items).sort((a,b)=>a.title.length-b.title.length)[0];window.__tgt=t.id;z.S.rules.kw.push({w:t.title.split(' ')[0],v:500})});
 const scr=await page.evaluate(()=>{const z=window.__zb;const s=z.scoreOf(z.S.items[window.__tgt]);return [s.total,s.rec]});const sc=scr[0],window_rec=scr[1];
 ok(sc>=500*0.99*window_rec,'关键词权重生效（+500×时效系数）：得分 '+sc.toFixed(1)+' 时效 '+window_rec.toFixed(2));
 await page.evaluate(()=>{window.__zb.S.rules.kw.pop()});
 // 星标/已读
 await page.evaluate(()=>{document.querySelector('.item [data-act=star]').click()});await sleep(200);
 ok(await page.evaluate(()=>Object.values(window.__zb.S.items).some(i=>i.star)),'星标可用');
 await page.evaluate(()=>{document.querySelector('.item [data-act=read]').click()});await sleep(200);
 ok(await page.evaluate(()=>Object.values(window.__zb.S.items).some(i=>i.read)),'已读可用');
 // 挑选 3 条
 for(let i=0;i<3;i++){await page.evaluate(()=>{[...document.querySelectorAll('.item [data-act=pick]')].find(b=>b.textContent.includes('＋')).click()});await sleep(200)}
 ok(await page.evaluate(()=>window.__zb.S.report.entries.length)===3,'选入 3 条周报');
 // ---- 粘贴导入 ----
 await page.goto('http://localhost:8161/#sources');await sleep(300);
 await page.type('#pText','测试标题一\nhttps://example.org/post-1?utm_source=x\n[Foo 文章](https://example.net/foo)\nhttps://example.org/post-1#top');
 await page.click('#pParse');await sleep(200);
 const pv=await page.$eval('#pPrev',e=>e.textContent);ok(/导入这 \d 条/.test(pv),'粘贴链接预览：'+pv.slice(0,60));
 await page.click('#pDo');await sleep(300);
 const man=await page.evaluate(()=>Object.values(window.__zb.S.items).filter(i=>i.manual).map(i=>i.title+'|'+i.canon));
 ok(man.length===2,'粘贴导入并按规范化链接去重（3 行 → 2 条）：'+JSON.stringify(man));
 // OPML
 await page.click('#pasteTabs [data-t=opml]');await page.type('#pText','<?xml version="1.0"?><opml version="2.0"><body><outline text="X" title="X站" type="rss" xmlUrl="https://x.example/feed.xml"/></body></opml>');await page.click('#pParse');await sleep(200);await page.click('#pDo');await sleep(300);
 ok(await page.evaluate(()=>window.__zb.S.sources.some(s=>s.url==='https://x.example/feed.xml')),'OPML 导入为信息源');
 // XML 粘贴
 await page.click('#pasteTabs [data-t=xml]');await page.evaluate(()=>{document.getElementById('pText').value='<rss version="2.0"><channel><title>手工源</title><item><title>手工条目甲</title><link>https://zz.example/a</link><pubDate>Sat, 17 Oct 2026 01:00:00 GMT</pubDate></item><item><title>手工条目甲</title><link>https://zz.example/b</link></item></channel></rss>'});await page.click('#pParse');await sleep(200);await page.click('#pDo');await sleep(300);
 const px=await page.evaluate(()=>Object.values(window.__zb.S.items).filter(i=>i.source==='手工源').length);ok(px===1,'XML 粘贴导入，同标题不同链接合并为 1 条：'+px);
 await page.screenshot({path:OUT+'/desktop-5-sources-paste.png',fullPage:true});
 // ---- 周报 ----
 await page.goto('http://localhost:8161/#report');await sleep(400);
 await page.type('#rTitle','产品信息周报 · 第 42 期');await page.type('#rPeriod','2026-10-12 ~ 2026-10-18');await page.type('#rIntro','本周看三件事。');
 const tas=await page.$$('.ent textarea');await tas[0].type('点评甲：对我们的定价有参考价值');await tas[1].type('点评乙');
 const gi=await page.$$('.ent input[data-k=group]');await gi[0].type('行业动态');
 const md=await page.evaluate(()=>window.__zb.buildMd());
 const ents=await page.evaluate(()=>window.__zb.S.report.entries);
 ok(ents.every(e=>md.includes(e.url.replace(/\)/g,'%29'))),'Markdown 每条含原文链接');
 ok(md.includes('点评甲：对我们的定价有参考价值')&&md.includes('（待填写点评）'),'Markdown 含点评，缺失处标“待填写”');
 ok(md.includes('## 行业动态')&&md.includes('## 其他'),'分组输出');
 const html=await page.evaluate(()=>window.__zb.buildHtml(true));ok(/<!doctype html>/.test(html)&&ents.every(e=>html.includes('href="'+e.url.replace(/&/g,'&amp;')+'"')),'HTML 导出含每条原文链接');
 // XSS：标题含脚本
 await page.evaluate(()=>{window.__zb.S.report.entries[0].title='<img src=x onerror=alert(1)>'});const h2=await page.evaluate(()=>window.__zb.buildHtml(true));ok(!h2.includes('<img src=x'),'HTML 导出转义标题');
 await page.evaluate(()=>{window.__zb.S.report.entries[0].title='恢复标题'});
 await page.click('[data-pv=md]');await sleep(100);await page.screenshot({path:OUT+'/desktop-6-report.png',fullPage:true});
 // AI（模拟接口）
 await page.evaluate(()=>{localStorage.setItem('zhoubao-ai',JSON.stringify({base:'http://localhost:8162/v1'.replace('/v1',''),model:'mock',key:'sk-test-123'}))});
 await page.goto('http://localhost:8161/#report');await sleep(300);await page.reload();await sleep(500);
 promptAnswer='素材：这是一段来自订阅源的摘要。';
 await page.evaluate(()=>document.querySelector('.ent [data-act=ai]').click());await sleep(1500);
 const aiRes=await page.evaluate(()=>window.__zb.S.report.entries[0].ai);
 ok(aiRes==='这是模拟接口返回的摘要。'&&aiBody&&aiBody.auth==='Bearer sk-test-123','AI 链路（模拟接口）：请求带 key、结果写回：'+aiRes);
 await page.evaluate(()=>{window.__zb.S.report.includeAI=true});
 const md2=await page.evaluate(()=>window.__zb.buildMd());ok(md2.includes('AI 生成，需核对'),'AI 摘要导出时带“AI 生成，需核对”标注');
 // ---- 备份往返 ----
 await page.goto('http://localhost:8161/#backup');await sleep(300);
 const snap=await page.evaluate(()=>{const z=window.__zb;const o=JSON.parse(JSON.stringify(z.S));return JSON.stringify({app:'zhoubao',version:1,data:o})});
 ok(!snap.includes('sk-test-123'),'备份文件不含 AI key');
 fs.writeFileSync('/tmp/zb-backup.json',snap);
 const cntBefore=await page.evaluate(()=>Object.keys(window.__zb.S.items).length);
 await page.click('#bkClear');await sleep(400);
 ok(await page.evaluate(()=>Object.keys(window.__zb.S.items).length)===0,'清空数据');
 const fh=await page.$('#bkFile');await fh.uploadFile('/tmp/zb-backup.json');await sleep(400);await page.click('#bkReplace');await sleep(600);
 ok(await page.evaluate(()=>Object.keys(window.__zb.S.items).length)===cntBefore,'备份导入还原条目数 '+cntBefore);
 // 刷新后仍在（IndexedDB 持久化）
 await sleep(500);await page.reload();await sleep(700);
 ok(await page.evaluate(()=>Object.keys(window.__zb.S.items).length)===cntBefore&&await page.evaluate(()=>window.__zb.S.report.entries.length)===3,'刷新页面后数据仍在（IndexedDB）');
 await page.screenshot({path:OUT+'/desktop-7-backup.png',fullPage:true});
 await page.goto('http://localhost:8161/#rules');await sleep(300);await page.screenshot({path:OUT+'/desktop-8-rules.png',fullPage:true});
 // ---- 手机 ----
 const m=await br.newPage();await m.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 m.on('pageerror',e=>errs.push('m:'+e.message));
 await m.goto('http://localhost:8161/#pool');await sleep(600);
 // 复用数据：注入备份
 await m.evaluate(async s=>{const j=JSON.parse(s);const r=indexedDB.open('zhoubao-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');await new Promise(res=>{r.onsuccess=()=>{const t=r.result.transaction('kv','readwrite');t.objectStore('kv').put(j.data,'state');t.oncomplete=res}})},snap);
 for(const [v,name] of [['pool','1-pool'],['sources','2-sources'],['rules','3-rules'],['report','4-report'],['backup','5-backup']]){await m.goto('http://localhost:8161/#'+v);await m.reload();await sleep(700);if(v==='pool')await m.evaluate(()=>window.scrollTo(0,document.getElementById('poolList').getBoundingClientRect().top+scrollY-120));await m.screenshot({path:OUT+`/mobile-${name}.png`,fullPage:v!=='pool'})}
 const ovf=await m.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);ok(!ovf,'手机端无横向溢出');
 ok(errs.length===0,'页面无未捕获异常 '+errs.join(';'));
 console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
 fs.writeFileSync(path.join(__dirname,'result.txt'),results.join('\n')+`\n\n通过 ${pass} / 失败 ${fail}\n`);
 await br.close();srv.close();ai.close();
})().catch(e=>{console.error(e);process.exit(1)});
