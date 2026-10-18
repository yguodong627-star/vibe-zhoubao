(function(){
'use strict';
/* ========== 工具 ========== */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const DAY=864e5;
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2600)}
function fmtDate(ts){if(!ts)return '时间未知';const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function ago(ts){if(!ts)return '时间未知';const d=(Date.now()-ts)/DAY;if(d<0)return '刚刚';if(d<1/24)return '刚刚';if(d<1)return Math.floor(d*24)+' 小时前';if(d<30)return Math.floor(d)+' 天前';return fmtDate(ts)}
function fnv(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
function download(name,text,type){const b=new Blob([text],{type:type||'text/plain;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function stripHtml(h){if(!h)return '';const d=new DOMParser().parseFromString(h,'text/html');return (d.body.textContent||'').replace(/\s+/g,' ').trim()}

/* ========== 存储：IndexedDB（失败回退 localStorage）========== */
const DBN='zhoubao-v1';
function idb(){return new Promise((res,rej)=>{if(!window.indexedDB)return rej(new Error('no idb'));const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function dbGet(k){try{const d=await idb();return await new Promise((res,rej)=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}catch(e){const v=localStorage.getItem(DBN+':'+k);return v?JSON.parse(v):undefined}}
async function dbSet(k,v){try{const d=await idb();await new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})}catch(e){try{localStorage.setItem(DBN+':'+k,JSON.stringify(v))}catch(e2){toast('保存失败：存储空间不足或被浏览器禁用，请立即导出备份')}}}

/* ========== 状态 ========== */
const DEFAULT_KW=[{w:'AI',v:3},{w:'产品',v:2},{w:'增长',v:2},{w:'定价',v:2},{w:'用户研究',v:2},{w:'pricing',v:2},{w:'product',v:1},{w:'PLG',v:2},{w:'广告',v:-2}];
const defRules=()=>({kw:JSON.parse(JSON.stringify(DEFAULT_KW)),halfLife:7,maxAge:30,pointsW:1,starBonus:3,dedupSim:0.85,defaultSrcW:3});
const defReport=()=>({title:'',period:'',intro:'',entries:[],tpl:'team',group:true,includeAI:false,customTpls:[]});
let S=null;
function freshState(){return {v:1,sources:[],items:{},rules:defRules(),report:defReport(),meta:{lastBackup:0,created:Date.now()}}}
let saveT=null;
function save(){clearTimeout(saveT);saveT=setTimeout(flush,250)}
function flush(){clearTimeout(saveT);return dbSet('state',S)}
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
window.addEventListener('pagehide',flush);

/* ========== URL 规范化 / 去重 ========== */
const TRACK=/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|spm$|ref_src$|ref$|igshid$|yclid$|_hsenc$|_hsmi$)/i;
function canonUrl(u){try{const x=new URL(u);if(!/^https?:$/.test(x.protocol))return null;x.protocol='https:';x.hash='';x.hostname=x.hostname.toLowerCase().replace(/^www\./,'');if(x.port==='443'||x.port==='80')x.port='';
 const ps=[...x.searchParams.entries()].filter(([k])=>!TRACK.test(k)).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);x.search='';ps.forEach(([k,v])=>x.searchParams.append(k,v));
 let p=x.pathname.replace(/\/+$/,'');if(!p)p='';return x.hostname+(x.port?':'+x.port:'')+p+x.search}catch(e){return null}}
function normTitle(t){return String(t||'').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'')}
function bigrams(s){const n=normTitle(s);const set=new Set();if(n.length<2){if(n)set.add(n);return set}for(let i=0;i<n.length-1;i++)set.add(n.slice(i,i+2));return set}
function dice(a,b){if(!a.size||!b.size)return 0;let c=0;for(const x of a)if(b.has(x))c++;return 2*c/(a.size+b.size)}
const bgCache=new Map();
function bgOf(it){let b=bgCache.get(it.id);if(!b){b=bigrams(it.title);bgCache.set(it.id,b)}return b}

/* ========== 抓取与解析 ========== */
function child(el,names){names=[].concat(names);for(const c of el.children){if(names.includes(c.localName))return c}return null}
function childText(el,names){const c=child(el,names);return c?(c.textContent||'').trim():''}
function parseFeed(text){
  const doc=new DOMParser().parseFromString(text,'text/xml');
  if(doc.querySelector('parsererror')||!doc.documentElement)throw new Error('内容不是有效的 XML（可能是网页而不是订阅源）');
  const root=doc.documentElement,rn=root.localName;
  if(!['rss','feed','RDF'].includes(rn))throw new Error('XML 根节点是 <'+rn+'>，不是 RSS / Atom 订阅源');
  const chan=rn==='rss'?child(root,'channel'):root;
  const title=chan?childText(chan,'title'):'';
  const els=rn==='feed'?[...root.children].filter(c=>c.localName==='entry'):[...doc.getElementsByTagName('item')];
  const items=els.map(e=>{
    let link='';
    if(rn==='feed'){const ls=[...e.children].filter(c=>c.localName==='link');const alt=ls.find(l=>(l.getAttribute('rel')||'alternate')==='alternate')||ls[0];link=alt?alt.getAttribute('href')||'':''}
    else{link=childText(e,'link');if(!/^https?:/i.test(link)){const g=child(e,'guid');if(g&&/^https?:/i.test(g.textContent.trim()))link=g.textContent.trim();else{const l2=child(e,'link');if(l2&&l2.getAttribute('href'))link=l2.getAttribute('href')}}}
    const dt=childText(e,['pubDate','published','updated','date','created'])||'';
    let ts=Date.parse(dt);if(isNaN(ts))ts=null;
    const sum=childText(e,['description','summary','encoded','content']);
    return {title:stripHtml(childText(e,'title')),url:link.trim(),published:ts,summary:stripHtml(sum).slice(0,500),points:null,comments:null}
  }).filter(x=>x.title&&x.url);
  return {title,items};
}
async function getText(url,opt){
  const ac=new AbortController();const t=setTimeout(()=>ac.abort(),20000);
  try{const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:ac.signal,...(opt||{})});
    if(!r.ok){const e=new Error('服务器返回 HTTP '+r.status+(r.status===403||r.status===429?'（被拒绝或限流，稍后再试）':''));e.http=true;throw e}
    return await r.text()}
  catch(e){if(e.http)throw e;
    if(e.name==='AbortError')throw new Error('请求超时（20 秒）');
    if(/^http:/i.test(url)&&location.protocol==='https:')throw new Error('该地址是 http，本页是 https，浏览器禁止混合内容。请改用 https 地址或粘贴导入');
    throw new Error('无法读取：该站点没有开放跨域（CORS）或网络/地址有误。浏览器不会告诉页面具体是哪一种。若地址在浏览器里能正常打开，请用下方“粘贴导入”')}
  finally{clearTimeout(t)}
}
const HN_MODES={front:'首页热帖',week:'近 7 天高分',show:'Show HN（近 7 天）',search:'关键词搜索（近 30 天）'};
async function fetchSource(src){
  if(src.type==='rss'){const f=parseFeed(await getText(src.url));return {items:f.items,title:f.title}}
  if(src.type==='hn'){
    const p=src.params||{};const hits=Math.min(100,+p.n||40);const min=+p.min||0;const now=Math.floor(Date.now()/1000);let u;
    const base='https://hn.algolia.com/api/v1/';
    if(p.mode==='front')u=base+'search?tags=front_page&hitsPerPage='+hits;
    else if(p.mode==='show')u=base+'search?tags=show_hn&hitsPerPage='+hits+'&numericFilters='+encodeURIComponent('created_at_i>'+(now-7*86400)+(min?',points>='+min:''));
    else if(p.mode==='search')u=base+'search?tags=story&hitsPerPage='+hits+'&query='+encodeURIComponent(p.q||'')+'&numericFilters='+encodeURIComponent('created_at_i>'+(now-30*86400)+(min?',points>='+min:''));
    else u=base+'search?tags=story&hitsPerPage='+hits+'&numericFilters='+encodeURIComponent('created_at_i>'+(now-7*86400)+',points>='+(min||50));
    const j=JSON.parse(await getText(u));
    const items=(j.hits||[]).map(h=>({title:h.title||h.story_title||'',url:h.url||('https://news.ycombinator.com/item?id='+h.objectID),published:h.created_at_i?h.created_at_i*1000:null,summary:'HN 讨论：https://news.ycombinator.com/item?id='+h.objectID,points:h.points||0,comments:h.num_comments||0})).filter(x=>x.title);
    return {items}
  }
  if(src.type==='gh'){
    const p=src.params||{};const days=+p.days||7;const since=new Date(Date.now()-days*DAY).toISOString().slice(0,10);
    let q='created:>'+since+(p.lang?' language:'+p.lang:'')+(p.q?' '+p.q:'');
    const u='https://api.github.com/search/repositories?sort=stars&order=desc&per_page='+Math.min(50,+p.n||30)+'&q='+encodeURIComponent(q);
    const j=JSON.parse(await getText(u,{headers:{Accept:'application/vnd.github+json'}}));
    const items=(j.items||[]).map(r=>({title:r.full_name+(r.description?' — '+(r.description.length>70?r.description.slice(0,70)+'…':r.description):''),url:r.html_url,published:Date.parse(r.created_at)||null,summary:[r.description,r.language?'语言：'+r.language:'','★ '+r.stargazers_count].filter(Boolean).join(' · '),points:r.stargazers_count,comments:null})).filter(x=>x.title);
    return {items}
  }
  throw new Error('未知类型')
}

/* 入池：规范化去重 + 标题相似去重 */
function ingest(raw,src){
  const r={added:0,dup:0,merged:0,bad:0};const sim=S.rules.dedupSim;
  const all=Object.values(S.items);
  for(const x of raw){
    const canon=canonUrl(x.url);if(!canon||!x.title){r.bad++;continue}
    const id=fnv(canon);const ex=S.items[id];
    if(ex){r.dup++;if(x.points!=null&&(ex.points==null||x.points>ex.points))ex.points=x.points;if(x.comments!=null)ex.comments=x.comments;if(!ex.published&&x.published)ex.published=x.published;continue}
    const it={id,url:x.url,canon,title:x.title,source:src.name,srcId:src.id,published:x.published||null,summary:x.summary||'',points:x.points,comments:x.comments,added:Date.now(),read:false,star:false,also:[],manual:!!src.manual};
    let merged=false;
    if(sim<1){const b=bigrams(it.title);if(b.size>=4){for(const o of all){if(o.srcId===it.srcId&&false)continue;const ob=bgOf(o);if(ob.size>=4&&dice(b,ob)>=sim){o.also=o.also||[];if(!o.also.some(a=>a.url===it.url)){o.also.push({source:it.source,url:it.url,title:it.title})}if(it.points!=null&&(o.points==null||it.points>o.points))o.points=it.points;merged=true;break}}}}
    if(merged){r.merged++;continue}
    S.items[id]=it;all.push(it);r.added++
  }
  save();return r;
}

/* ========== 打分 ========== */
function kwHit(text,w){if(!text)return false;const k=w.trim();if(!k)return false;
  if(/^[A-Za-z0-9 ._+\-#]+$/.test(k)){const re=new RegExp('(^|[^A-Za-z0-9])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^A-Za-z0-9])','i');return re.test(text)}
  return text.toLowerCase().includes(k.toLowerCase())}
function scoreOf(it){
  const R=S.rules;const src=S.sources.find(s=>s.id===it.srcId);
  const srcScore=src?+src.weight:R.defaultSrcW;
  const heat=it.points?Math.log(1+it.points)*R.pointsW:0;
  const hits=[];let kw=0;
  for(const k of R.kw){const t=kwHit(it.title,k.w),s=!t&&kwHit(it.summary,k.w);if(t){kw+=+k.v;hits.push([k.w,+k.v,'标题'])}else if(s){kw+=+k.v*0.5;hits.push([k.w,+k.v*0.5,'摘要'])}}
  const ts=it.published||it.added;const age=Math.max(0,(Date.now()-ts)/DAY);
  const rec=age>R.maxAge?0:Math.pow(0.5,age/Math.max(.1,R.halfLife));
  const star=it.star?R.starBonus:0;
  const total=(srcScore+heat+kw)*rec+star;
  return {total,srcScore,heat,kw,hits,rec,age,star,noDate:!it.published}
}

/* ========== 视图切换 ========== */
const VIEWS=['pool','sources','rules','report','backup'];
function route(){const v=(location.hash||'#pool').slice(1);const cur=VIEWS.includes(v)?v:'pool';
  VIEWS.forEach(x=>{$('#v-'+x).hidden=x!==cur});$$('#nav a').forEach(a=>a.classList.toggle('on',a.dataset.v===cur));
  ({pool:renderPool,sources:renderSources,rules:renderRules,report:renderReport,backup:renderBackup})[cur]();
  window.scrollTo({top:0,behavior:'instant'})}
function refreshAll(){const v=(location.hash||'#pool').slice(1)||'pool';
  ({pool:renderPool,sources:renderSources,rules:renderRules,report:renderReport,backup:renderBackup}[VIEWS.includes(v)?v:'pool'])();renderStats()}

function renderStats(){
  const its=Object.values(S.items);const unread=its.filter(i=>!i.read).length,star=its.filter(i=>i.star).length;
  const lb=S.meta.lastBackup;
  $('#stats').innerHTML=`<div><dt>条目池</dt><dd>${its.length}<small>条</small></dd></div><div><dt>未读</dt><dd>${unread}<small>条</small></dd></div><div><dt>已选入周报</dt><dd>${S.report.entries.length}<small>条</small></dd></div><div><dt>上次备份</dt><dd style="font-size:${lb?'26px':'30px'}">${lb?fmtDate(lb):'尚未'}</dd></div>`;
  const bar=$('#backupBar');
  const need=its.length>0&&(!lb||(Date.now()-lb)>7*DAY);
  bar.hidden=!need;
  if(need)bar.innerHTML=`<div class="note warn bar"><span>${lb?'距上次备份已超过 7 天':'你还没有备份过'}。数据只存在本浏览器，清理浏览器数据就会丢失。</span><a class="btn sm" href="#backup">去备份</a></div>`;
}

/* ========== 条目池 ========== */
const F={q:'',status:'all',src:'',range:'all',sort:'score',limit:60};
function filtered(){
  const q=F.q.trim().toLowerCase();const picked=new Set(S.report.entries.map(e=>e.itemId));const now=Date.now();
  let list=Object.values(S.items).filter(i=>{
    if(q&&!(i.title+' '+i.summary).toLowerCase().includes(q))return false;
    if(F.status==='unread'&&i.read)return false;if(F.status==='star'&&!i.star)return false;
    if(F.status==='picked'&&!picked.has(i.id))return false;if(F.status==='unpicked'&&picked.has(i.id))return false;
    if(F.src&&i.srcId!==F.src&&!(F.src==='_manual'&&i.manual))return false;
    if(F.range!=='all'&&((i.published||i.added)<now-(+F.range)*DAY))return false;return true});
  list=list.map(i=>({i,s:scoreOf(i)}));
  list.sort(F.sort==='time'?(a,b)=>(b.i.published||b.i.added)-(a.i.published||a.i.added):(a,b)=>b.s.total-a.s.total||(b.i.published||0)-(a.i.published||0));
  return list;
}
function renderPool(){
  const sel=$('#fsrc');const cur=F.src;
  const opts=['<option value="">全部来源</option>'].concat(S.sources.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`));
  sel.innerHTML=opts.join('');sel.value=cur;
  $('#fq').value=F.q;$('#fstatus').value=F.status;$('#frange').value=F.range;$('#fsort').value=F.sort;
  const list=filtered();const total=Object.keys(S.items).length;const picked=new Set(S.report.entries.map(e=>e.itemId));
  $('#poolCount').textContent=total?`显示 ${Math.min(list.length,F.limit)} / 符合条件 ${list.length} / 池内共 ${total}`:'';
  const box=$('#poolList');
  if(!total){box.innerHTML=`<div class="empty"><h3>条目池还是空的</h3><p>先到“信息源”添加订阅（有一批实测可直连的源可以一键添加），或者粘贴链接 / OPML / RSS XML。抓到的条目会出现在这里，去重并按你的规则排序。</p><a class="btn solid" href="#sources">去添加信息源</a></div>`;return}
  if(!list.length){box.innerHTML='<div class="empty"><h3>没有符合条件的条目</h3><p>放宽左侧的筛选条件试试。</p></div>';return}
  box.innerHTML=list.slice(0,F.limit).map(({i,s},n)=>{
    const p=picked.has(i.id);
    return `<article class="item ${i.read?'read':''} ${n<3&&F.sort==='score'?'top3':''}" data-id="${i.id}">
 <button class="score" data-act="bd" title="点击查看得分明细">${s.total.toFixed(1)}<small>得分</small></button>
 <div><a class="i-title" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" data-act="open">${esc(i.title)}</a>
 <div class="i-meta"><span>${esc(i.source)}</span><span title="${i.published?new Date(i.published).toLocaleString('zh-CN'):'源未提供发布时间，按抓取时间计'}">${i.published?ago(i.published):'无发布时间'}</span>${i.points!=null?`<span>${i.points} 赞/星</span>`:''}${i.comments!=null?`<span>${i.comments} 评论</span>`:''}${i.also&&i.also.length?`<span title="${esc(i.also.map(a=>a.source+'：'+a.title).join('\n'))}">另有 ${i.also.length} 个来源报道（已合并）</span>`:''}</div>
 ${i.summary?`<p class="i-sum">${esc(i.summary)}</p>`:''}
 <div class="i-act"><button class="btn sm star ${i.star?'on':''}" data-act="star">${i.star?'★ 已星标':'☆ 星标'}</button><button class="btn sm ${i.read?'on':''}" data-act="read">${i.read?'已读':'标为已读'}</button><button class="btn sm ${p?'on':''}" data-act="pick">${p?'✓ 已在周报':'＋ 周报'}</button><button class="link" data-act="edit">改标题</button><button class="link" data-act="del">删除</button></div></div>
 <div class="bd" hidden></div></article>`}).join('')+(list.length>F.limit?`<div style="padding:24px 0"><button class="btn" id="moreBtn">再显示 60 条（还有 ${list.length-F.limit} 条）</button></div>`:'');
}
function breakdown(it){const s=scoreOf(it);const src=S.sources.find(x=>x.id===it.srcId);
  return `<div><b>来源分</b> ${s.srcScore.toFixed(1)}（${src?esc(src.name)+' 的权重':'手动导入，用默认来源权重'}）</div>
<div><b>热度分</b> ${s.heat.toFixed(2)}${it.points?`（ln(1+${it.points}) × ${S.rules.pointsW}）`:'（无点赞数据）'}</div>
<div><b>关键词分</b> ${s.kw.toFixed(1)}${s.hits.length?'（'+s.hits.map(h=>`${esc(h[0])} ${h[1]>0?'+':''}${h[1]}·${h[2]}`).join('，')+'）':'（无命中）'}</div>
<div><b>时效系数</b> ${s.rec.toFixed(3)}（发布 ${s.age.toFixed(1)} 天，半衰期 ${S.rules.halfLife} 天${s.noDate?'；<span style="color:var(--warn)">源未给发布时间，按抓取时间计</span>':''}${s.age>S.rules.maxAge?'；已超过最长时效，记 0':''}）</div>
<div><b>星标加成</b> ${s.star}</div>
<div style="border-top:1px solid var(--rule);margin-top:4px;padding-top:4px"><b>合计</b> (${s.srcScore.toFixed(1)} + ${s.heat.toFixed(2)} + ${s.kw.toFixed(1)}) × ${s.rec.toFixed(3)} + ${s.star} = <b>${s.total.toFixed(2)}</b></div>`}

function poolEvents(){
  const on=(id,ev,fn)=>$(id).addEventListener(ev,fn);
  on('#fq','input',e=>{F.q=e.target.value;F.limit=60;renderPoolListOnly()});
  [['#fstatus','status'],['#fsrc','src'],['#frange','range'],['#fsort','sort']].forEach(([id,k])=>on(id,'change',e=>{F[k]=e.target.value;F.limit=60;renderPool()}));
  $('#poolList').addEventListener('click',e=>{
    if(e.target.id==='moreBtn'){F.limit+=60;renderPool();return}
    const b=e.target.closest('[data-act]');if(!b)return;const art=b.closest('.item');const it=S.items[art.dataset.id];const a=b.dataset.act;
    if(a==='open'){if(!it.read){it.read=true;art.classList.add('read');save();renderStats()}return}
    if(a==='bd'){const d=$('.bd',art);d.hidden=!d.hidden;if(!d.hidden)d.innerHTML=breakdown(it);return}
    if(a==='star'){it.star=!it.star;save();renderPool();renderStats()}
    if(a==='read'){it.read=!it.read;save();renderPool();renderStats()}
    if(a==='pick'){togglePick(it);renderPool();renderStats()}
    if(a==='edit'){const t=prompt('修改标题（仅改本地显示，链接不变）',it.title);if(t&&t.trim()){it.title=t.trim();bgCache.delete(it.id);save();renderPool()}}
    if(a==='del'){if(confirm('从条目池删除这条？（若在周报里，周报条目也会移除）')){delete S.items[it.id];S.report.entries=S.report.entries.filter(x=>x.itemId!==it.id);save();renderPool();renderStats()}}
  });
  on('#btnRefresh','click',refreshAllSources);
  on('#btnMarkAll','click',()=>{const l=filtered();if(!l.length)return;if(!confirm('把当前筛选出的 '+l.length+' 条全部标为已读？'))return;l.forEach(x=>x.i.read=true);save();renderPool();renderStats()});
}
function renderPoolListOnly(){const y=window.scrollY;renderPoolKeepFocus();window.scrollTo(0,y)}
function renderPoolKeepFocus(){const el=document.activeElement;const id=el&&el.id;renderPool();if(id==='fq'){const f=$('#fq');f.focus();f.setSelectionRange(f.value.length,f.value.length)}}
function togglePick(it){
  const R=S.report;const k=R.entries.findIndex(e=>e.itemId===it.id);
  if(k>=0){if(R.entries[k].comment&&!confirm('这条已写了点评，移出周报会丢失点评。继续？'))return;R.entries.splice(k,1)}
  else R.entries.push({itemId:it.id,title:it.title,url:it.url,source:it.source,date:it.published||0,comment:'',group:'',ai:'',aiSrc:'',aiMaterial:''});
  save();
}

/* ========== 抓取全部 ========== */
let fetching=false;
async function refreshSource(s){
  s.status='run';
  try{const r=await fetchSource(s);if(r.title&&(!s.name||s.autoName))s.name=r.title,s.autoName=false;const g=ingest(r.items.map(x=>x),s);s.status='ok';s.msg=`抓到 ${r.items.length} 条：新增 ${g.added}，已存在 ${g.dup}，标题相似合并 ${g.merged}`;s.last=Date.now();return g}
  catch(e){s.status='fail';s.msg=e.message;s.last=Date.now();return null}
}
async function refreshAllSources(){
  if(fetching)return;const list=S.sources.filter(s=>s.enabled!==false);
  if(!list.length){toast('还没有信息源');location.hash='#sources';return}
  fetching=true;const btn=$('#btnRefresh');btn.disabled=true;let add=0,fail=0;const msg=$('#refreshMsg');
  for(let i=0;i<list.length;i++){msg.textContent=`正在抓取 ${i+1}/${list.length}：${list[i].name}`;const g=await refreshSource(list[i]);if(g)add+=g.added;else fail++}
  fetching=false;btn.disabled=false;save();msg.textContent=`完成：新增 ${add} 条，${fail} 个源失败（原因见“信息源”页）`;refreshAll();
}

/* ========== 信息源页 ========== */
const PRESETS=[
 {name:'少数派',type:'rss',url:'https://sspai.com/feed',note:'中文，效率/数码/产品'},
 {name:'极客公园',type:'rss',url:'https://www.geekpark.net/rss',note:'中文科技/产品'},
 {name:'雷峰网',type:'rss',url:'https://www.leiphone.com/feed',note:'中文，AI / 科技'},
 {name:'Simon Willison’s Weblog',type:'rss',url:'https://simonwillison.net/atom/everything/',note:'英文，AI 工具实践'},
 {name:'Wired',type:'rss',url:'https://www.wired.com/feed/rss',note:'英文，科技综合'},
 {name:'GitHub Blog',type:'rss',url:'https://github.blog/feed/',note:'英文，开发者/产品更新'},
 {name:'Google Blog',type:'rss',url:'https://blog.google/rss/',note:'英文，Google 官方'},
 {name:'DEV Community',type:'rss',url:'https://dev.to/feed',note:'英文，开发者社区'},
 {name:'Hacker News 首页',type:'hn',params:{mode:'front',n:40,min:0},note:'官方 Algolia 搜索接口'},
 {name:'Hacker News 近 7 天 ≥100 分',type:'hn',params:{mode:'week',n:40,min:100},note:'一周热帖，适合周报'},
 {name:'GitHub 近 7 天新仓库（按 star）',type:'gh',params:{days:7,n:30,lang:'',q:''},note:'GitHub 没有官方 trending 接口，这是 Search API 的近似'}
];
const BLOCKED=[
 ['36氪 36kr.com/feed','未返回 CORS 头'],['阮一峰的网络日志','站点返回 403 / 无 CORS 头'],['Product Hunt /feed','未返回 CORS 头；官方 GraphQL API 需要登录 token'],['The Verge','未返回 CORS 头'],['Lenny’s Newsletter','未返回 CORS 头'],['IT之家 / V2EX / 知乎 rss','未返回 CORS 头'],['Reddit .rss','HTTP 403 / 限流，且无 CORS 头'],['TechCrunch','CORS 头只允许其自家域名'],['Hugging Face / OpenAI 新闻 RSS','未返回 CORS 头'],['人人都是产品经理 woshipm.com/feed','未返回 CORS 头'],['Product Talk / SVPG / Nielsen Norman Group / Figma Blog / Stratechery','未返回 CORS 头'],['爱范儿 / 钛媒体 / 虎嗅','未返回 CORS 头或无法访问'],['PingWest 品玩 /feed','该地址返回 404 页面，不是订阅源']];
const ADD={tab:'rss'};
function addFormHtml(){
  if(ADD.tab==='rss')return `<div class="grid2"><div><label class="f" for="aUrl">订阅地址（https）</label><input id="aUrl" type="url" placeholder="https://example.com/feed.xml"></div><div><label class="f" for="aName">名称（可留空，自动取订阅标题）</label><input id="aName" type="text"></div></div><div class="row" style="margin-top:12px"><button class="btn solid sm" id="aGo">测试并添加</button><span class="small muted">会先真实请求一次，失败不会假装添加成功</span></div>`;
  if(ADD.tab==='hn')return `<div class="grid2"><div><label class="f" for="hMode">模式</label><select id="hMode">${Object.entries(HN_MODES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div><label class="f" for="hQ">搜索词（仅“关键词搜索”用）</label><input id="hQ" type="text" placeholder="product management"></div><div><label class="f" for="hMin">最低分数</label><input id="hMin" type="number" value="50"></div><div><label class="f" for="hN">条数（≤100）</label><input id="hN" type="number" value="40"></div></div><div class="row" style="margin-top:12px"><button class="btn solid sm" id="aGo">测试并添加</button></div>`;
  return `<div class="grid2"><div><label class="f" for="gDays">仓库创建于近几天</label><input id="gDays" type="number" value="7"></div><div><label class="f" for="gN">条数（≤50）</label><input id="gN" type="number" value="30"></div><div><label class="f" for="gLang">语言（可空）</label><input id="gLang" type="text" placeholder="typescript"></div><div><label class="f" for="gQ">附加搜索词（可空）</label><input id="gQ" type="text" placeholder="ai agent"></div></div><p class="small muted">GitHub 没有公开的官方 “trending” 接口。这里用 Search API 查“近 N 天新建、按 star 排序”的仓库，是近似而非 trending 页的原榜单。未登录时搜索接口限流较严（约每分钟 10 次）。</p><div class="row"><button class="btn solid sm" id="aGo">测试并添加</button></div>`;
}
function renderSources(){
  $('#srcList').innerHTML=S.sources.length?S.sources.map(s=>`<div class="src" data-id="${s.id}"><div><div class="nm">${esc(s.name)} <span class="chip">${s.manual?'粘贴':s.type==='rss'?'RSS':s.type==='hn'?'HN':'GitHub'}</span></div><div class="u">${esc(s.manual?'手动粘贴导入的条目归在这里，可调权重':s.url||(s.type==='hn'?'hn.algolia.com · '+HN_MODES[s.params.mode]+(s.params.q?' · '+s.params.q:''):'api.github.com 搜索'))}</div><div class="st ${s.status||''}">${s.status==='ok'?'✓ ':s.status==='fail'?'✗ ':''}${esc(s.msg||'尚未抓取')}${s.last?' · '+ago(s.last):''}</div></div>
<div class="src-act"><label class="small muted" title="来源分（0–10）">权重 <input type="number" min="0" max="10" step="0.5" value="${s.weight}" data-act="w"></label>${s.manual?'':`<button class="btn sm" data-act="fetch">抓取</button><button class="btn sm ${s.enabled===false?'':'solid'}" data-act="en">${s.enabled===false?'已停用':'启用中'}</button>`}<button class="link" data-act="rm">删除</button></div></div>`).join(''):'<p class="muted">还没有信息源。右边可以一键添加实测可直连的源。</p>';
  $('#presetNote').textContent='实测日期 2026-10-18（见 README）。站点方日后可能改动跨域设置，失败时本页会如实显示原因。';
  $('#presetList').innerHTML=PRESETS.map((p,i)=>{const has=S.sources.some(s=>(p.url&&s.url===p.url)||(!p.url&&s.type===p.type&&JSON.stringify(s.params)===JSON.stringify(p.params)));return `<div class="preset"><div><div class="nm">${esc(p.name)}</div><div class="small muted">${esc(p.note)}</div></div><button class="btn sm" data-p="${i}" ${has?'disabled':''}>${has?'已添加':'添加'}</button></div>`}).join('');
  $('#addForm').innerHTML=addFormHtml();
  $$('#addTabs .chip').forEach(c=>c.classList.toggle('on',c.dataset.t===ADD.tab));
  renderPaste();
  $('#blockedList').innerHTML=`<div class="eyebrow" style="margin-bottom:10px">实测不能直连的常见源（2026-10-18）</div><table><tr><th>站点</th><th>原因</th></tr>${BLOCKED.map(b=>`<tr><td>${esc(b[0])}</td><td>${esc(b[1])}</td></tr>`).join('')}</table><p class="small" style="color:var(--on-dark-mute);margin-top:10px">这些源并非不能读，只是“网页里的脚本”读不了。你可以在新标签打开它们的订阅地址，复制全部内容后粘贴到上面的“RSS / Atom XML”。</p>`;
}
function newSource(o){return Object.assign({id:uid(),name:'',type:'rss',url:'',weight:S.rules.defaultSrcW,enabled:true,status:'',msg:'',last:0},o)}
async function addSourceAndTest(o,btn){
  const s=newSource(o);btn&&(btn.disabled=true,btn.textContent='正在测试…');
  const g=await refreshSource(s);btn&&(btn.disabled=false,btn.textContent='测试并添加');
  if(s.status==='fail'){alert('未添加。\n\n'+s.msg);return false}
  if(!s.name)s.name=s.url||'未命名';
  S.sources.push(s);save();toast('已添加：'+s.name+'（'+s.msg+'）');refreshAll();return true;
}
function sourcesEvents(){
  $('#srcList').addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;const row=b.closest('.src');const s=S.sources.find(x=>x.id===row.dataset.id);const a=b.dataset.act;
    if(a==='fetch'){b.disabled=true;b.textContent='抓取中…';await refreshSource(s);save();renderSources();renderStats()}
    if(a==='en'){s.enabled=s.enabled===false;save();renderSources()}
    if(a==='rm'){const n=Object.values(S.items).filter(i=>i.srcId===s.id).length;if(confirm('删除信息源“'+s.name+'”？'+(n?'\n它已抓取的 '+n+' 条条目会保留在条目池（可自行删除）。':''))){S.sources=S.sources.filter(x=>x!==s);save();renderSources()}}});
  $('#srcList').addEventListener('change',e=>{if(e.target.dataset.act==='w'){const s=S.sources.find(x=>x.id===e.target.closest('.src').dataset.id);s.weight=Math.max(0,Math.min(10,+e.target.value||0));save()}});
  $('#presetList').addEventListener('click',async e=>{const b=e.target.closest('[data-p]');if(!b)return;const p=PRESETS[+b.dataset.p];b.disabled=true;b.textContent='测试中…';const ok=await addSourceAndTest({name:p.name,type:p.type,url:p.url||'',params:p.params,weight:p.type==='rss'?3:4});if(!ok){b.disabled=false;b.textContent='添加'}});
  $('#addTabs').addEventListener('click',e=>{const c=e.target.closest('[data-t]');if(!c)return;ADD.tab=c.dataset.t;renderSources()});
  $('#addForm').addEventListener('click',async e=>{if(e.target.id!=='aGo')return;const b=e.target;
    if(ADD.tab==='rss'){const u=$('#aUrl').value.trim();if(!/^https?:\/\//i.test(u))return alert('请填写以 http(s):// 开头的地址');if(S.sources.some(s=>s.url===u))return alert('已添加过这个地址');const n=$('#aName').value.trim();await addSourceAndTest({name:n,autoName:!n,type:'rss',url:u},b)}
    else if(ADD.tab==='hn'){const m=$('#hMode').value,q=$('#hQ').value.trim();if(m==='search'&&!q)return alert('关键词搜索需要填搜索词');await addSourceAndTest({name:'Hacker News · '+HN_MODES[m]+(q?'：'+q:''),type:'hn',weight:4,params:{mode:m,q,min:+$('#hMin').value||0,n:+$('#hN').value||40}},b)}
    else await addSourceAndTest({name:'GitHub 新仓库'+($('#gLang').value?'（'+$('#gLang').value+'）':'')+($('#gQ').value?' '+$('#gQ').value:''),type:'gh',weight:4,params:{days:+$('#gDays').value||7,n:+$('#gN').value||30,lang:$('#gLang').value.trim(),q:$('#gQ').value.trim()}},b)});
}

/* 粘贴导入 */
const PASTE={tab:'links',parsed:null,srcName:'手动粘贴'};
function parseLinks(text){
  const out=[];const lines=text.split(/\r?\n/);let pend='';const URLRE=/https?:\/\/[^\s<>"'）)\]】]+/g;
  for(const raw of lines){const line=raw.trim();if(!line){pend='';continue}
    const md=[...line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)];
    if(md.length){md.forEach(m=>out.push({title:m[1].trim(),url:m[2]}));pend='';continue}
    const us=line.match(URLRE);
    if(us){let t=line.replace(URLRE,' ').replace(/[|｜\-–—:：<>\[\]()（）]+/g,' ').replace(/\s+/g,' ').trim();if(!t)t=pend;us.forEach(u=>out.push({title:t||u.replace(/^https?:\/\//,'').slice(0,80),url:u.replace(/[.,;，。；]+$/,'')}));pend=''}
    else pend=line}
  return out.map(x=>({...x,published:null,summary:'',points:null,comments:null}));
}
function parseOpml(text){const d=new DOMParser().parseFromString(text,'text/xml');if(d.querySelector('parsererror'))throw new Error('不是有效的 OPML / XML');
  const o=[...d.getElementsByTagName('outline')].filter(x=>x.getAttribute('xmlUrl')||x.getAttribute('xmlurl'));
  if(!o.length)throw new Error('OPML 中没有找到带 xmlUrl 的订阅条目');
  return o.map(x=>({name:x.getAttribute('title')||x.getAttribute('text')||'',url:x.getAttribute('xmlUrl')||x.getAttribute('xmlurl')}))}
function renderPaste(){
  $$('#pasteTabs .chip').forEach(c=>c.classList.toggle('on',c.dataset.t===PASTE.tab));
  const t=PASTE.tab;const ph={links:'每行一条，支持：\n标题 | https://链接\nhttps://链接\n[标题](https://链接)\n或“标题一行 + 链接一行”（微信/飞书复制的常见格式）',xml:'粘贴 RSS / Atom 的 XML 全文…',opml:'粘贴 OPML 全文（Feedly / Inoreader / 其他阅读器导出的订阅列表）…'}[t];
  $('#pasteForm').innerHTML=`<div class="fld"><textarea id="pText" placeholder="${esc(ph)}"></textarea></div><div class="row"><label class="small" style="color:var(--on-dark-mute)">来源名称 <input id="pSrc" type="text" value="${esc(PASTE.srcName)}" style="width:180px;display:inline-block;padding:4px 8px"></label><input type="file" id="pFile" accept=".xml,.opml,.rss,.atom,.txt,.md,.html,text/*" style="max-width:240px;font-size:12px"><button class="btn light sm" id="pParse">解析并预览</button></div><div id="pPrev"></div>`;
}
function showPreview(kind,data){
  PASTE.parsed={kind,data};const box=$('#pPrev');
  if(kind==='opml'){box.innerHTML=`<div class="pv-box">${data.map(d=>`<div>${esc(d.name||'(无名)')} — ${esc(d.url)}</div>`).join('')}</div><div class="row" style="margin-top:12px"><button class="btn light sm" id="pDo">添加这 ${data.length} 个订阅为信息源（不预先测试）</button><span class="small" style="color:var(--on-dark-mute)">其中不支持跨域的源，抓取时会如实报错；那就改用 XML 粘贴。</span></div>`;return}
  box.innerHTML=`<div class="pv-box">${data.slice(0,200).map(d=>`<div>${esc(d.title)} — ${esc(d.url)}${d.published?' · '+fmtDate(d.published):''}</div>`).join('')}${data.length>200?`<div>…另有 ${data.length-200} 条</div>`:''}</div><div class="row" style="margin-top:12px"><button class="btn light sm" id="pDo">导入这 ${data.length} 条到条目池</button><span class="small" style="color:var(--on-dark-mute)">没有标题的链接会用网址当标题，可在条目池点“改标题”。</span></div>`;
}
function handlePaste(text){
  const t=text.trim();if(!t)return alert('没有内容');
  try{
    if(/<opml[\s>]/i.test(t))return showPreview('opml',parseOpml(t));
    if(/<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0,3000))){const f=parseFeed(t);if(!f.items.length)throw new Error('订阅源里没有条目');PASTE.srcName=f.title||PASTE.srcName;const i=$('#pSrc');if(i)i.value=PASTE.srcName;return showPreview('items',f.items)}
    if(PASTE.tab==='xml')throw new Error('内容看起来不是 RSS / Atom XML');
    if(PASTE.tab==='opml')throw new Error('内容看起来不是 OPML');
    const l=parseLinks(t);if(!l.length)throw new Error('没有识别到任何 http(s) 链接');showPreview('items',l)
  }catch(e){$('#pPrev').innerHTML=`<div class="note bad" style="margin-top:12px">${esc(e.message)}</div>`}
}
function pasteEvents(){
  $('#pasteTabs').addEventListener('click',e=>{const c=e.target.closest('[data-t]');if(!c)return;PASTE.tab=c.dataset.t;renderPaste()});
  $('#pasteForm').addEventListener('click',e=>{
    if(e.target.id==='pParse')handlePaste($('#pText').value);
    if(e.target.id==='pDo'){const P=PASTE.parsed;if(!P)return;
      if(P.kind==='opml'){let n=0;P.data.forEach(d=>{if(!S.sources.some(s=>s.url===d.url)){S.sources.push(newSource({name:d.name||d.url,url:d.url,type:'rss'}));n++}});save();toast('已添加 '+n+' 个信息源，可在上方列表逐个抓取');renderSources()}
      else{const name=($('#pSrc').value.trim()||'手动粘贴');PASTE.srcName=name;let src=S.sources.find(s=>s.manual&&s.name===name);if(!src){src={id:'m_'+fnv(name),name,type:'manual',weight:S.rules.defaultSrcW,manual:true,enabled:false};if(!S.sources.some(s=>s.id===src.id))S.sources.push(src)}
        const g=ingest(P.data.map(x=>x),src);toast(`导入完成：新增 ${g.added}，已存在 ${g.dup}，相似合并 ${g.merged}，无效 ${g.bad}`);$('#pPrev').innerHTML=`<div class="note ok" style="margin-top:12px">新增 ${g.added} 条，已存在 ${g.dup}，标题相似合并 ${g.merged}，无效 ${g.bad}。到“条目池”查看。</div>`;renderStats()}}});
  $('#pasteForm').addEventListener('change',async e=>{if(e.target.id==='pFile'&&e.target.files[0]){const txt=await e.target.files[0].text();$('#pText').value=txt;handlePaste(txt)}});
}

/* ========== 规则页 ========== */
function renderRules(){
  const R=S.rules;
  $('#kwList').innerHTML=R.kw.length?R.kw.map((k,i)=>`<div class="kw" data-i="${i}"><input type="text" value="${esc(k.w)}" data-k="w"><input type="number" step="0.5" value="${k.v}" data-k="v" aria-label="权重"><button class="link" data-act="rm">删除</button></div>`).join(''):'<p class="muted small">没有关键词，关键词分恒为 0。</p>';
  const P=[['halfLife','时效半衰期（天）','每过这么多天，时效系数减半',.5],['maxAge','最长时效（天）','超过则得分归 0（仍可搜索、手动挑选）',1],['pointsW','热度系数','热度分 = ln(1+赞数) × 系数；0 表示不看赞数',.1],['starBonus','星标加成（分）','星标条目额外加分',.5],['dedupSim','标题相似合并阈值（0.5–1）','不同链接但标题相似度（字符二元组 Dice 系数）≥ 阈值时合并为一条；设为 1 关闭',.01],['defaultSrcW','默认来源权重（0–10）','新建信息源 / 手动导入使用',.5]];
  $('#paramForm').innerHTML=P.map(p=>`<div><label class="f" for="p_${p[0]}">${p[1]}</label><input id="p_${p[0]}" type="number" step="${p[3]}" value="${R[p[0]]}" data-p="${p[0]}"><div class="hint">${p[2]}</div></div>`).join('');
}
function rulesEvents(){
  $('#kwList').addEventListener('input',e=>{const r=e.target.closest('.kw');if(!r)return;const k=S.rules.kw[+r.dataset.i];if(e.target.dataset.k==='w')k.w=e.target.value;else k.v=parseFloat(e.target.value)||0;save()});
  $('#kwList').addEventListener('click',e=>{if(e.target.dataset.act==='rm'){S.rules.kw.splice(+e.target.closest('.kw').dataset.i,1);save();renderRules()}});
  $('#kwAdd').addEventListener('click',()=>{const w=$('#kwWord').value.trim();if(!w)return;S.rules.kw.push({w,v:parseFloat($('#kwW').value)||0});$('#kwWord').value='';save();renderRules()});
  $('#kwWord').addEventListener('keydown',e=>{if(e.key==='Enter')$('#kwAdd').click()});
  $('#paramForm').addEventListener('input',e=>{const k=e.target.dataset.p;if(!k)return;let v=parseFloat(e.target.value);if(isNaN(v))return;if(k==='dedupSim')v=Math.max(.5,Math.min(1,v));S.rules[k]=v;save()});
  $('#rulesReset').addEventListener('click',()=>{if(confirm('恢复默认规则？你自定义的关键词和参数会被覆盖。')){S.rules=defRules();save();renderRules()}});
}

/* ========== 周报 ========== */
const BUILTIN_TPL=[
 {id:'team',name:'团队周报（标题 + 点评）',head:'# {{周报标题}}\n\n> 周期：{{周期}}\n\n{{导语}}\n\n',group:'## {{分组}}\n\n',item:'### {{序号}}. [{{标题}}]({{链接}})\n\n- 来源：{{来源}}　{{日期}}\n{{AI摘要}}- **点评：** {{点评}}\n\n',foot:'---\n\n共 {{条数}} 条，每条链接均指向原文。\n'},
 {id:'list',name:'极简清单',head:'# {{周报标题}}（{{周期}}）\n\n{{导语}}\n\n',group:'**{{分组}}**\n\n',item:'- [{{标题}}]({{链接}})（{{来源}}）\n  - 点评：{{点评}}\n{{AI摘要}}',foot:'\n'},
 {id:'mail',name:'邮件正文（纯文本风格）',head:'{{周报标题}}\n{{周期}}\n\n{{导语}}\n\n',group:'【{{分组}}】\n',item:'{{序号}}. {{标题}}\n   原文：{{链接}}\n   点评：{{点评}}\n{{AI摘要}}\n',foot:'—— 共 {{条数}} 条\n'}
];
function allTpls(){return BUILTIN_TPL.concat(S.report.customTpls)}
function mdEsc(t){return String(t).replace(/([\[\]\\])/g,'\\$1').replace(/\s+/g,' ')}
function mdUrl(u){return u.replace(/ /g,'%20').replace(/\)/g,'%29').replace(/\(/g,'%28')}
function buildMd(){
  const R=S.report;const tpl=allTpls().find(t=>t.id===R.tpl)||BUILTIN_TPL[0];const E=R.entries;
  const fill=(s,m)=>s.replace(/\{\{([^}]+)\}\}/g,(a,k)=>k in m?m[k]:a);
  let out=fill(tpl.head,{'周报标题':R.title||'（未填标题）','周期':R.period||'（未填周期）','导语':R.intro||''});
  const groups=[];const useG=R.group&&tpl.group&&E.some(e=>e.group);
  if(useG){const m=new Map();E.forEach(e=>{const g=e.group||'其他';if(!m.has(g))m.set(g,[]);m.get(g).push(e)});m.forEach((v,k)=>groups.push([k,v]))}else groups.push([null,E]);
  let n=0;
  for(const [g,list] of groups){if(g!==null)out+=fill(tpl.group,{'分组':g});
    for(const e of list){n++;const ai=R.includeAI&&e.ai?`- AI 摘要（AI 生成，需核对）：${e.ai.replace(/\n+/g,' ')}\n`:'';
      out+=fill(tpl.item,{'序号':n,'标题':mdEsc(e.title),'链接':mdUrl(e.url),'来源':e.source,'日期':e.date?fmtDate(e.date):'','点评':e.comment.trim()?e.comment.trim().replace(/\n+/g,' '):'（待填写点评）','AI摘要':ai,'分组':e.group||''})}}
  out+=fill(tpl.foot,{'条数':E.length});return out.replace(/\n{3,}/g,'\n\n');
}
function buildHtml(full){
  const R=S.report,E=R.entries;const useG=R.group&&E.some(e=>e.group);const m=new Map();
  E.forEach(e=>{const g=useG?(e.group||'其他'):'';if(!m.has(g))m.set(g,[]);m.get(g).push(e)});
  let n=0,body=`<h1>${esc(R.title||'（未填标题）')}</h1><p class="per">${esc(R.period||'')}</p>${R.intro?`<p>${esc(R.intro).replace(/\n/g,'<br>')}</p>`:''}`;
  m.forEach((list,g)=>{if(g)body+=`<h2>${esc(g)}</h2>`;list.forEach(e=>{n++;body+=`<div class="it"><div class="t">${n}. <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a></div><div class="s">来源：${esc(e.source)}${e.date?'　'+fmtDate(e.date):''}</div>${R.includeAI&&e.ai?`<div class="ai">AI 摘要（AI 生成，需核对）：${esc(e.ai)}</div>`:''}<blockquote>${e.comment.trim()?'点评：'+esc(e.comment.trim()).replace(/\n/g,'<br>'):'<i>点评：（待填写）</i>'}</blockquote></div>`})});
  body+=`<p class="ft">共 ${E.length} 条，每条链接均指向原文。</p>`;
  if(!full)return body;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(R.title||'周报')}</title><style>body{margin:0;background:#f0efe9;color:#23343e;font:15px/1.8 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:760px;margin:0 auto;padding:40px 22px 70px}h1{font:400 34px/1.3 "Songti SC",SimSun,serif;margin:0}h2{font-size:15px;color:#39718b;margin:30px 0 4px;letter-spacing:.5px}.per{color:#6a777d;margin:4px 0 18px}.it{border-top:1px solid #20343f26;padding:14px 0}.t{font-weight:600}.t a{color:#102a36}.s{font-size:12px;color:#6a777d}blockquote{margin:8px 0 0;padding-left:12px;border-left:2px solid #39718b;color:#4a5d67}.ai{margin-top:6px;font-size:13px;background:#f6efdf;padding:6px 10px;color:#5b3d0a}.ft{border-top:1px solid #20343f26;margin-top:20px;padding-top:12px;font-size:12px;color:#6a777d}</style></head><body><main>${body}</main></body></html>`;
}
const PV={mode:'html'};
function renderReport(){
  const R=S.report;
  $('#rTitle').value=R.title;$('#rPeriod').value=R.period;$('#rIntro').value=R.intro;$('#rGroup').checked=R.group;$('#rAI').checked=R.includeAI;
  $('#rTpl').innerHTML=allTpls().map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');$('#rTpl').value=R.tpl;
  renderEntries();renderPreview();renderTplEditor();renderAiBox();
}
function groupsList(){return [...new Set(S.report.entries.map(e=>e.group).filter(Boolean))]}
function renderEntries(){
  const E=S.report.entries;const miss=E.filter(e=>!e.comment.trim()).length;
  $('#entCount').textContent='已选条目 '+E.length;$('#entWarn').textContent=E.length&&miss?`有 ${miss} 条还没写点评`:'';
  if(!E.length){$('#entries').innerHTML=`<div class="empty" style="padding:36px 0"><h3 style="font-size:26px">还没有选入条目</h3><p>去条目池，按得分挑出这一周值得写的几条，点 “＋ 周报”。</p><a class="btn solid" href="#pool">去条目池</a></div>`;return}
  const dl=groupsList();
  $('#entries').innerHTML=`<datalist id="glist">${dl.concat(['行业动态','竞品','工具与方法','值得读'].filter(x=>!dl.includes(x))).map(g=>`<option value="${esc(g)}">`).join('')}</datalist>`+E.map((e,i)=>`<div class="ent" data-i="${i}"><div class="ent-h"><div class="ent-n">${i+1}</div><div><input type="text" value="${esc(e.title)}" data-k="title" aria-label="标题"><a class="url" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></div><div class="ent-ctl"><button class="btn sm" data-act="up" title="上移" ${i?'':'disabled'}>↑</button><button class="btn sm" data-act="dn" title="下移" ${i<E.length-1?'':'disabled'}>↓</button><button class="btn sm danger" data-act="rm" title="移出周报">×</button></div></div>
<textarea data-k="comment" class="${e.comment.trim()?'':'bad-c'}" placeholder="你的点评：这条信息对我们意味着什么？（必填，导出时空白会标“待填写”）">${esc(e.comment)}</textarea>
<div class="ent-row"><input type="text" list="glist" data-k="group" value="${esc(e.group)}" placeholder="分组（可选，如 竞品）"><button class="btn sm" data-act="ai">AI 摘要…</button></div>
${e.ai?`<div class="ai-out"><b>AI 生成，需核对</b>：${esc(e.ai)} <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">原文</a> <button class="link" data-act="aiDel">删除</button></div>`:''}</div>`).join('');
}
function renderPreview(){
  $('#prevHtml').innerHTML=S.report.entries.length?buildHtml(false):'<p class="muted">选入条目后，这里显示排版预览。</p>';
  $('#prevMd').textContent=buildMd();
  $('#prevHtml').hidden=PV.mode!=='html';$('#prevMd').hidden=PV.mode!=='md';
  $$('[data-pv]').forEach(c=>c.classList.toggle('on',c.dataset.pv===PV.mode));
}
function reportEvents(){
  const R=()=>S.report;
  [['#rTitle','title'],['#rPeriod','period'],['#rIntro','intro']].forEach(([id,k])=>$(id).addEventListener('input',e=>{R()[k]=e.target.value;save();renderPreview()}));
  $('#rGroup').addEventListener('change',e=>{R().group=e.target.checked;save();renderPreview()});
  $('#rAI').addEventListener('change',e=>{R().includeAI=e.target.checked;save();renderPreview()});
  $('#rTpl').addEventListener('change',e=>{R().tpl=e.target.value;save();renderPreview();renderTplEditor()});
  $('#entries').addEventListener('input',e=>{const r=e.target.closest('.ent');if(!r||!e.target.dataset.k)return;const en=R().entries[+r.dataset.i];en[e.target.dataset.k]=e.target.value;if(e.target.dataset.k==='comment')e.target.classList.toggle('bad-c',!e.target.value.trim());save();renderPreview();const miss=R().entries.filter(x=>!x.comment.trim()).length;$('#entWarn').textContent=miss?`有 ${miss} 条还没写点评`:''});
  $('#entries').addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;const i=+b.closest('.ent').dataset.i;const E=R().entries;const a=b.dataset.act;
    if(a==='up'&&i>0)[E[i-1],E[i]]=[E[i],E[i-1]];
    if(a==='dn'&&i<E.length-1)[E[i+1],E[i]]=[E[i],E[i+1]];
    if(a==='rm'){if(E[i].comment&&!confirm('这条已写点评，确认移出？'))return;E.splice(i,1)}
    if(a==='aiDel'){E[i].ai=''}
    if(a==='ai'){await runAI(i);return}
    save();renderEntries();renderPreview();renderStats()});
  $$('[data-pv]').forEach(c=>c.addEventListener('click',()=>{PV.mode=c.dataset.pv;renderPreview()}));
  $('#cpMd').addEventListener('click',async()=>{const t=buildMd();try{await navigator.clipboard.writeText(t);toast('已复制 Markdown')}catch(e){PV.mode='md';renderPreview();const r=document.createRange();r.selectNodeContents($('#prevMd'));getSelection().removeAllRanges();getSelection().addRange(r);toast('浏览器不允许自动复制，已选中源码，请手动复制')}});
  const warnMiss=()=>{const m=R().entries.filter(x=>!x.comment.trim()).length;return !m||confirm(`还有 ${m} 条没写点评，导出时会标“（待填写点评）”。仍要导出吗？`)};
  const fname=ext=>(R().title||'周报').replace(/[\\/:*?"<>|]/g,'_')+'.'+ext;
  $('#dlMd').addEventListener('click',()=>{if(!R().entries.length)return toast('还没有条目');if(warnMiss())download(fname('md'),buildMd(),'text/markdown;charset=utf-8')});
  $('#dlHtml').addEventListener('click',()=>{if(!R().entries.length)return toast('还没有条目');if(warnMiss())download(fname('html'),buildHtml(true),'text/html;charset=utf-8')});
}
function renderTplEditor(){
  const R=S.report;const t=allTpls().find(x=>x.id===R.tpl)||BUILTIN_TPL[0];const builtin=BUILTIN_TPL.some(x=>x.id===t.id);
  $('#tplEditor').innerHTML=`<p class="small" style="color:var(--on-dark-mute)">可用占位符：{{周报标题}} {{周期}} {{导语}} {{条数}}；分组：{{分组}}；条目：{{序号}} {{标题}} {{链接}} {{来源}} {{日期}} {{点评}} {{AI摘要}}。${builtin?'内置模板不可直接改，修改后“另存为新模板”。':''}</p>
  <label class="f">模板名称</label><input type="text" id="tName" value="${esc(builtin?t.name+'（副本）':t.name)}">
  <label class="f" style="margin-top:8px">开头</label><textarea id="tHead">${esc(t.head)}</textarea>
  <label class="f">分组小标题</label><textarea id="tGroup" style="min-height:44px">${esc(t.group)}</textarea>
  <label class="f">每条</label><textarea id="tItem">${esc(t.item)}</textarea>
  <label class="f">结尾</label><textarea id="tFoot" style="min-height:44px">${esc(t.foot)}</textarea>
  <div class="row"><button class="btn light sm" id="tSave">${builtin?'另存为新模板':'保存修改'}</button>${builtin?'':'<button class="btn glass sm" id="tSaveAs">另存为新模板</button><button class="btn glass sm" id="tDel">删除此模板</button>'}</div>
  <p class="small" style="color:var(--on-dark-mute)">提示：自定义模板里请保留 {{链接}} 和 {{点评}}，否则导出的周报会缺原文链接或点评。</p>`;
  const get=()=>({name:$('#tName').value.trim()||'自定义模板',head:$('#tHead').value,group:$('#tGroup').value,item:$('#tItem').value,foot:$('#tFoot').value});
  const warn=o=>(!/\{\{链接\}\}/.test(o.item)||!/\{\{点评\}\}/.test(o.item))?confirm('模板的“每条”里缺少 {{链接}} 或 {{点评}}，导出的周报将缺原文链接或点评栏。仍要保存？'):true;
  const saveNew=()=>{const o=get();if(!warn(o))return;o.id='c_'+uid();R.customTpls.push(o);R.tpl=o.id;save();renderReport();toast('已保存模板')};
  $('#tSave').onclick=()=>{if(builtin)return saveNew();const o=get();if(!warn(o))return;Object.assign(t,o);save();renderReport();toast('已保存')};
  const sa=$('#tSaveAs');if(sa)sa.onclick=saveNew;
  const td=$('#tDel');if(td)td.onclick=()=>{if(confirm('删除模板“'+t.name+'”？')){R.customTpls=R.customTpls.filter(x=>x!==t);R.tpl='team';save();renderReport()}};
}

/* ===== AI 摘要（可选，key 只存 localStorage，不进备份）===== */
const AIK='zhoubao-ai';
const aiCfg=()=>{try{return JSON.parse(localStorage.getItem(AIK))||{}}catch(e){return {}}};
function renderAiBox(){
  const c=aiCfg();
  $('#aiBox').innerHTML=`<p class="small" style="color:var(--on-dark-mute)">完全可选，不填也能完整使用。填写后，“AI 摘要…”会把<b>该条的标题和订阅源自带的摘要（或你粘贴的片段）</b>发送到下面的接口（OpenAI 兼容的 /chat/completions）。key 只保存在本机浏览器，不会写入备份，也不会上传到本站（本站没有服务器）。<b>能否从网页直接调用取决于该接口是否允许跨域，我无法替你验证。</b></p>
  <label class="f">接口地址（Base URL）</label><input type="text" id="aiBase" value="${esc(c.base||'https://api.openai.com/v1')}">
  <label class="f" style="margin-top:6px">模型名</label><input type="text" id="aiModel" value="${esc(c.model||'')}" placeholder="例如 gpt-4o-mini / deepseek-chat">
  <label class="f" style="margin-top:6px">API Key</label><input type="password" id="aiKey" value="${esc(c.key||'')}" autocomplete="off">
  <div class="row" style="margin-top:10px"><button class="btn light sm" id="aiSave">保存到本机</button><button class="btn glass sm" id="aiClear">清除 key</button></div>`;
  $('#aiSave').onclick=()=>{localStorage.setItem(AIK,JSON.stringify({base:$('#aiBase').value.trim().replace(/\/+$/,''),model:$('#aiModel').value.trim(),key:$('#aiKey').value.trim()}));toast('已保存到本机')};
  $('#aiClear').onclick=()=>{localStorage.removeItem(AIK);renderAiBox();toast('已清除')};
}
async function runAI(i){
  const c=aiCfg();if(!c.key||!c.model||!c.base){alert('请先在右侧“AI 摘要”里填接口地址、模型名和 key（可选功能，不填不影响其他功能）');$('#aiBox').closest('details').open=true;return}
  const e=S.report.entries[i];const it=S.items[e.itemId];
  let mat=e.aiMaterial||'';if(!mat)mat=(it&&it.summary)||'';
  const extra=prompt('给 AI 的素材（来自订阅源的摘要，可替换或补充为你粘贴的原文片段）。\n将发送到：'+c.base+'\n留空取消。',mat);
  if(!extra||!extra.trim())return;e.aiMaterial=extra.trim();
  const btn=$$('.ent')[i].querySelector('[data-act=ai]');btn.disabled=true;btn.textContent='生成中…';
  try{
    const r=await fetch(c.base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.key},referrerPolicy:'no-referrer',credentials:'omit',body:JSON.stringify({model:c.model,temperature:.2,messages:[{role:'system',content:'你是严谨的编辑助手。只依据用户给的素材，用中文写不超过 80 字的摘要；不得添加素材中没有的事实、数字或判断；素材不足以概括时只回答“素材不足”。'},{role:'user',content:'标题：'+e.title+'\n素材：'+e.aiMaterial}]})});
    if(!r.ok)throw new Error('接口返回 HTTP '+r.status+'：'+(await r.text()).slice(0,200));
    const j=await r.json();const t=j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content;if(!t)throw new Error('接口返回格式不是 OpenAI 兼容格式');
    e.ai=t.trim();save();renderEntries();renderPreview();toast('已生成，请对照原文核对')
  }catch(err){const m=err instanceof TypeError?'请求失败：多半是该接口不允许网页跨域调用（CORS），或网络不通。可改用支持浏览器直连的接口。':err.message;alert(m);btn.disabled=false;btn.textContent='AI 摘要…'}
}

/* ========== 备份页 ========== */
function renderBackup(){
  const n=Object.keys(S.items).length;$('#bkInfo').textContent=`条目 ${n} · 信息源 ${S.sources.length} · 周报条目 ${S.report.entries.length}`;
  if(navigator.storage&&navigator.storage.estimate)navigator.storage.estimate().then(e=>{$('#bkInfo').textContent+=` · 约占用 ${(e.usage/1024).toFixed(0)} KB`}).catch(()=>{});
}
let bkData=null;
function backupEvents(){
  $('#bkExport').addEventListener('click',()=>{const o=JSON.parse(JSON.stringify(S));o.meta.lastBackup=Date.now();S.meta.lastBackup=o.meta.lastBackup;save();download('周报台备份-'+fmtDate(Date.now())+'.json',JSON.stringify({app:'zhoubao',version:1,exported:Date.now(),data:o},null,1),'application/json');renderStats();toast('已导出（不含 AI key）')});
  $('#bkFile').addEventListener('change',async e=>{bkData=null;const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text());if(j.app!=='zhoubao'||!j.data||!j.data.items)throw new Error('不是周报台的备份文件');bkData=j.data;toast('已读取：'+Object.keys(j.data.items).length+' 条，请选择合并或覆盖')}catch(err){alert('读取失败：'+err.message)}});
  $('#bkMerge').addEventListener('click',()=>{if(!bkData)return alert('请先选择备份文件');let a=0;for(const [k,v] of Object.entries(bkData.items))if(!S.items[k]){S.items[k]=v;a++}
    (bkData.sources||[]).forEach(s=>{if(!S.sources.some(x=>x.id===s.id||(s.url&&x.url===s.url)))S.sources.push(s)});
    if(!S.report.entries.length&&bkData.report)S.report=Object.assign(defReport(),bkData.report);
    save();bgCache.clear();toast('合并完成：新增 '+a+' 条');refreshAll()});
  $('#bkReplace').addEventListener('click',()=>{if(!bkData)return alert('请先选择备份文件');if(!confirm('覆盖会替换当前全部数据，确定？（建议先导出当前数据）'))return;S=Object.assign(freshState(),bkData);S.rules=Object.assign(defRules(),S.rules);S.report=Object.assign(defReport(),S.report);save();bgCache.clear();toast('已覆盖导入');refreshAll()});
  $('#bkClear').addEventListener('click',()=>{if(confirm('清空全部数据？此操作不可恢复。建议先导出备份。')&&confirm('再确认一次：真的清空？')){S=freshState();bgCache.clear();save();toast('已清空');refreshAll()}});
}

/* ========== 启动 ========== */
async function init(){
  S=await dbGet('state');
  if(!S||!S.items){S=freshState()}
  S.rules=Object.assign(defRules(),S.rules||{});S.report=Object.assign(defReport(),S.report||{});S.meta=S.meta||{lastBackup:0};
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  poolEvents();sourcesEvents();pasteEvents();rulesEvents();reportEvents();backupEvents();
  window.addEventListener('hashchange',()=>{route();});
  route();renderStats();
  window.__zb={get S(){return S},canonUrl,parseFeed,parseLinks,scoreOf,ingest,buildMd,buildHtml,parseOpml};
}
init();
})();
