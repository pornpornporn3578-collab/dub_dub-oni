(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (value, decimals=1) => Number.isFinite(value) ? value.toLocaleString('zh-CN',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}) : '—';
  const percent = value => Number.isFinite(value) ? fmt(value*100)+'%' : '—';
  const names={THA:'泰国',IDN:'印度尼西亚',CHN:'中国 · 海南',CHN_YUNNAN:'中国 · 云南'};
  const colors={low:'#358060',medium:'#d49a3b',high:'#c46a60',unknown:'#b9c4c0'};
  const basisNames={production:'参考产量加权',area:'参考可割面积加权',get sample(){return data?.schema_version>=4?'不重复格点等权':'地区样本等权（旧口径）';}};
  let data, forecastData, host, state={country:'THA',group:'all',region:'all',basis:'production',date:'',search:'',year:0,comparison:'',sort:'production',scenario:'strict',window:30,years:[]};
  const scopeKeys=['country','group','region','basis','scenario'];
  const panels=Object.fromEntries(['trend','diagnosis','matrix','monthly','comparison','forecast'].map(key=>[key,{follow:true,scope:{},time:{}}]));
  const historyCache=new Map(),historyPending=new Map();
  const dayIndexes=new WeakMap();
  const itemId=item=>item?.id||item?.group_id;
  function historyPayload(key){const cached=historyCache.get(key),version=data?.history?.rule_version;if(cached&&version&&cached.rule_version!==version){historyCache.delete(key);return undefined;}return cached;}
  function indexedDay(rows,date){if(!Array.isArray(rows))return;let index=dayIndexes.get(rows);if(!index){index=new Map(rows.map(day=>[day.date,day]));dayIndexes.set(rows,index);}return index.get(date);}
  function byDate(item,date){const payload=historyPayload(itemId(item)+'|'+date.slice(0,4)),rows=payload?.daily_by_basis?.[state.basis]||payload?.daily;return indexedDay(rows,date)||indexedDay(item?.daily,date);}
  const countryIso=()=>state.country==='CHN_YUNNAN'?'CHN':state.country;
  const chinaGroup=()=>state.country==='CHN'?'g_chn_hainan':state.country==='CHN_YUNNAN'?'g_chn_yunnan':null;
  const baseRegions=()=>data.regions.filter(r=>r.country_iso3===countryIso()&&(!chinaGroup()||r.group_id===chinaGroup()||r.group_ids?.includes(chinaGroup())));
  const countryMembers=()=>{const ids=chinaGroup()?data.groups.find(g=>g.group_id===chinaGroup())?.region_ids:data.countries.find(c=>c.country_iso3===countryIso())?.region_ids;return ids?baseRegions().filter(r=>ids.includes(r.id)):baseRegions();};
  const overlappingDetails=()=>baseRegions().filter(r=>!countryMembers().some(member=>member.id===r.id));
  const regions=()=>state.group==='overlap_details'?overlappingDetails():countryMembers();
  const groups=()=>data.groups.filter(g=>g.country_iso3===countryIso()&&g.region_ids?.length>0&&(!chinaGroup()||g.group_id===chinaGroup()));
  const filtered=()=>regions().filter(r=>(state.group==='all'||state.group==='overlap_details'||r.group_ids?.includes(state.group)||r.group_id===state.group)&&(state.region==='all'||!state.region||r.id===state.region)&&(!state.search||(r.name+' '+r.name_original).toLowerCase().includes(state.search.toLowerCase())));
  const currentGroup=()=>state.group==='overlap_details'?null:state.group==='all' ? (chinaGroup()?data.groups.find(g=>g.group_id===chinaGroup()):data.countries.find(c=>c.country_iso3===countryIso())) : data.groups.find(g=>g.group_id===state.group);
  const weight=r=>state.basis==='production' ? r.reference?.production_tons : state.basis==='area'?r.reference?.tappable_area_ha:1;
  const scenarioName=()=>state.scenario==='inclusive'?'含中等干扰（宽松）':'仅无明显干扰（严格）';
  const conditionName=()=>state.scenario==='inclusive'?'宽松情景条件日数':'无明显降雨干扰条件日数';
  const revisedWindows=()=>String(data?.method?.local_windows?.dawn||'').includes('07:00');
  function components(day){
    if(!day||!Number.isFinite(day.adverse_share))return {low:null,medium:null,high:null};
    const low=Number.isFinite(day.low_share)?day.low_share:1-day.adverse_share;
    const high=Number.isFinite(day.high_share)?day.high_share:null;
    const medium=Number.isFinite(day.medium_share)?day.medium_share:Number.isFinite(high)?day.adverse_share-high:null;
    return {low,medium,high};
  }
  function eligibleShare(day){const c=components(day);return state.scenario==='inclusive'?(Number.isFinite(c.low)&&Number.isFinite(c.medium)?c.low+c.medium:null):c.low;}
  const eligibleRegion=day=>day?.risk_level==='low'||(state.scenario==='inclusive'&&day?.risk_level==='medium');
  const headlineItem=()=>chinaGroup()?data.groups.find(g=>g.group_id===chinaGroup()):data.countries.find(c=>c.country_iso3===countryIso());
  function datesInView(){
    // Use a contiguous calendar window, not the last N available rows (which could hide gaps).
    const latest=data.date_range?.end||(headlineItem()?.daily||[]).map(d=>d.date).sort().at(-1);
    if(!latest)return [];
    const end=new Date(latest+'T00:00:00Z');
    return Array.from({length:state.window},(_,i)=>new Date(end.getTime()-(state.window-1-i)*86400000).toISOString().slice(0,10));
  }
  function cardScopes(){
    const country=headlineItem(),cards=[{title:(names[state.country]||country?.label||state.country)+' · 总体',item:country,items:countryMembers(),national:true}];
    if(state.region&&state.region!=='all'){
      const region=rangeRegions().find(r=>r.id===state.region);
      if(region)cards.push({title:region.name,item:region,items:[region]});
    }else if(state.group==='overlap_details'){
      for(const region of overlappingDetails())cards.push({title:region.name,item:region,items:[region]});
    }else{
      for(const group of groups().filter(g=>(state.group==='all'||g.group_id===state.group)&&itemId(g)!==itemId(country)))cards.push({title:group.label,item:group,items:countryMembers().filter(r=>group.region_ids.includes(r.id))});
    }
    return cards;
  }
  function cardWindowSummary(scope,dates=datesInView()){
    const values=dates.map(date=>aggregateScope(scope.items,date,scope.item)),knownDays=values.filter(a=>Number.isFinite(a.share)).length;
    const mean=key=>values.length&&values.every(a=>Number.isFinite(a[key]))?values.reduce((sum,a)=>sum+a[key],0)/values.length:null;
    const partialDays=values.filter(a=>Number.isFinite(a.share)&&(!Number.isFinite(a.coverage)||a.coverage<.9999||a.partialCount>0)).length;
    return {share:mean('share'),coverage:values.length?values.reduce((sum,a)=>sum+(Number.isFinite(a.coverage)?a.coverage:0),0)/values.length:null,
      prod:partialDays?null:mean('prod'),area:partialDays?null:mean('area'),knownDays,partialDays};
  }
  const availableYears=()=>[...new Set(data.history?.available_years||data.board?.years||data.regions.flatMap(r=>(r.monthly_archive||[]).map(m=>Number(m.month.slice(0,4)))))].filter(Number.isFinite).sort((a,b)=>a-b);
  function withPanel(key,fn){const original={...state},panel=panels[key];if(!panel.follow)Object.assign(state,panel.scope);Object.assign(state,panel.time);if(!state.year)state.year=Number(data.date_range.end.slice(0,4));if(!state.month)state.month=Number(data.date_range.end.slice(5,7));state.panel=key;state.search=panel.follow&&['diagnosis','matrix','monthly'].includes(key)?original.search:'';try{return fn();}finally{for(const field of Object.keys(state))if(!(field in original))delete state[field];Object.assign(state,original);}}
  function setPanelFollow(key,follow){panels[key].follow=follow;panels[key].scope=follow?{}:Object.fromEntries(scopeKeys.map(k=>[k,state[k]]));}
  function setLocalScope(key,field,value){const panel=panels[key];if(panel.follow)setPanelFollow(key,false);panel.scope[field]=value;if(field==='country'){panel.scope.group='all';panel.scope.region='all';}if(field==='group')panel.scope.region='all';}
  function setDiagnosisDate(date,origin,region){const panel=panels.diagnosis;if(origin){const source=panels[origin];panel.follow=source.follow&&!region;panel.scope=Object.fromEntries(scopeKeys.map(k=>[k,source.follow?state[k]:source.scope[k]]));if(region)panel.scope.region=region;}Object.assign(panel.time,{date,year:Number(date.slice(0,4)),month:Number(date.slice(5,7)),day:Number(date.slice(8,10))});}
  function scopeItem(){return state.region&&state.region!=='all'?data.regions.find(r=>r.id===state.region):currentGroup();}
  function monthDates(year,month,limit=false){const days=new Date(Date.UTC(year,month,0)).getUTCDate();return Array.from({length:days},(_,i)=>year+'-'+String(month).padStart(2,'0')+'-'+String(i+1).padStart(2,'0')).filter(d=>!limit||d<=data.date_range.end);}
  function yearDates(year){return Array.from({length:12},(_,i)=>monthDates(year,i+1,true)).flat();}
  function countryOptions(){return data.countries.flatMap(c=>c.country_iso3==='CHN'?[['CHN',names.CHN],...(data.groups.some(g=>g.group_id==='g_chn_yunnan')?[['CHN_YUNNAN',names.CHN_YUNNAN]]:[])]:[[c.country_iso3,names[c.country_iso3]||c.label]]);}
  function rangeRegions(){const before=state.search;state.search='';const result=filtered();state.search=before;return result;}
  function candidates(){const before=state.region;state.region='all';const result=rangeRegions();state.region=before;return result;}
  function basisOptions(){const list=candidates();return [...(list.some(r=>Number.isFinite(r.reference?.production_tons))?[['production',basisNames.production]]:[]),...(list.some(r=>Number.isFinite(r.reference?.tappable_area_ha))?[['area',basisNames.area]]:[]),['sample',basisNames.sample]];}
  function localControls(key,extras=''){
    const panel=panels[key];if(!['all','overlap_details'].includes(state.group)&&!groups().some(g=>g.group_id===state.group)){state.group='all';state.region='all';if(!panel.follow)Object.assign(panel.scope,{group:'all',region:'all'});}const people=candidates(),basis=basisOptions();if(!basis.some(([id])=>id===state.basis)){state.basis=basis[0][0];if(!panel.follow)panel.scope.basis=state.basis;}
    if(state.region!=='all'&&!people.some(r=>r.id===state.region)){state.region='all';if(!panel.follow)panel.scope.region='all';}
    const choices={country:countryOptions(),group:[['all','全部大区'],...groups().map(g=>[g.group_id,g.label]),...(overlappingDetails().length?[['overlap_details','重叠县级样本（仅详情）']]:[])],region:[['all','全部产区'],...people.slice().sort((a,b)=>(b.reference?.production_tons||0)-(a.reference?.production_tons||0)).map(r=>[r.id,r.name])],basis,scenario:[['strict','仅无明显干扰（严格）'],['inclusive','含中等干扰（宽松）']]};
    const labels={country:'国家 / 区域',group:'大区',region:'产区',basis:'历史汇总权重',scenario:'评估情景'};
    return `<div class="tb-local-controls" data-tb-component="${key}"><div class="tb-sync"><label><input type="checkbox" data-tb-follow="${key}"${panel.follow?' checked':''}>跟随全局</label><button type="button" data-tb-sync="${key}">恢复同步</button><span>${panel.follow?'范围与情景同步 · 时间独立':'本块独立 · 不改变其他模块'}</span></div><div class="tb-controls"><div class="tb-scope-row">${scopeKeys.map(field=>`<label>${labels[field]}<select id="tb-${key}-${field}" data-tb-scope="${field}">${options(choices[field],state[field])}</select></label>`).join('')}</div>${extras?`<div class="tb-time-row">${extras}</div>`:''}</div></div>`;
  }
  function timeSelect(key,field,label,choices,value){return `<label>${label}<select id="tb-${key}-${field}" data-tb-time="${field}">${options(choices,String(value))}</select></label>`;}
  function yearSelect(key){return timeSelect(key,'year','年份',availableYears().slice().reverse().map(y=>[String(y),y+'年']),state.year);}
  function monthSelect(key,allowAll=false){return timeSelect(key,'month','月份',[...(allowAll?[['all','全部月份']]:[]),...Array.from({length:12},(_,i)=>[String(i+1),i+1+'月'])],state.month);}
  function historyMessage(key){const target=document.getElementById('tb-'+key+'-history');if(!target)return;const items=rangeRegions(),waiting=[...historyPending.keys()].some(k=>k.endsWith('|'+state.year)),failed=[...historyCache.entries()].filter(([k,v])=>k.endsWith('|'+state.year)&&v.error),referenceKey=state.basis==='production'?'production_tons':'tappable_area_ha',matched=items.filter(r=>Number.isFinite(r.reference?.[referenceKey])).length;let note=state.region&&state.region!=='all'?'单产区仅诊断本区格点分量，不把本区数值称为产量或面积加权。':state.basis==='sample'?(data.schema_version>=4?'国别 / 大区只代表已采样的不重复格点等权，不是全国胶园面积。':'当前载入旧地区样本等权口径；更新后改为不重复格点等权，均不代表全国胶园面积。'):`参考权重已匹配 ${matched}/${items.length} 个地区；${matched<items.length?'仅对已匹配参考地区计算，不代表全国或完整大区比例。':'参考统计口径不等同于当期实际产量 / 面积。'}`;if(key==='forecast')note='独立预报固定采用气候样本口径；本块历史权重与情景选择只作参照，不改变预报雨量。';target.textContent=note+(waiting?' 正在读取所选年份的历史日序列…':failed.length?' 部分历史文件尚未生成或读取失败；缺测保持空白，请运行每日更新程序补齐后刷新页面。':'');}
  async function loadHistory(item,year){const id=itemId(item),cacheKey=id+'|'+year;if(!id||!Number.isInteger(Number(year))||!/^[A-Za-z0-9_-]+$/.test(id)||historyPayload(cacheKey))return;if(historyPending.has(cacheKey))return historyPending.get(cacheKey);
    const template=data.history?.path_template||'data/tapping-history/{entity_id}/{year}.json',url=template.replace('{entity_id}',encodeURIComponent(id)).replace('{year}',String(year));
    const task=(async()=>{try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const payload=await response.json();if(payload.entity_id!==id||Number(payload.year)!==Number(year)||payload.source_type!=='reanalysis')throw Error('历史实体、年份或数据类型不一致');if(data.history?.rule_version&&payload.rule_version!==data.history.rule_version)throw Error('历史文件规则版本与主看板不一致，请重新更新');const rows=[...(payload.daily||[]),...Object.values(payload.daily_by_basis||{}).flat()];if(rows.some(row=>!String(row.date).startsWith(year+'-')||row.source_type==='forecast'))throw Error('历史文件混入其他年份或预报');historyCache.set(cacheKey,payload);}catch(error){historyCache.set(cacheKey,{daily:[],error:error.message,rule_version:data.history?.rule_version||null});}finally{historyPending.delete(cacheKey);}})();historyPending.set(cacheKey,task);return task;
  }
  function scheduleHistory(){if(!data.history)return;const tasks=[],queue=(item,year)=>{const cacheKey=itemId(item)+'|'+year;if(item&&!historyPayload(cacheKey))tasks.push(loadHistory(item,year));};const cardYears=[...new Set(datesInView().map(date=>Number(date.slice(0,4))))];for(const scope of cardScopes())for(const year of cardYears)for(const item of [scope.item,...scope.items])queue(item,year);for(const key of ['trend','diagnosis','matrix'])withPanel(key,()=>{const year=Number(state.year),scope=scopeItem(),items=key==='trend'&&scope?[scope]:filtered();for(const item of items)queue(item,year);if(key==='diagnosis')queue(scope,year);});if(tasks.length)Promise.all(tasks).then(render);}
  const sorted=()=>filtered().slice().sort((a,b)=>state.sort==='rate' ? (rateOf(b)-rateOf(a))||((b.reference?.production_tons??-1)-(a.reference?.production_tons??-1)) : (b.reference?.production_tons??-1)-(a.reference?.production_tons??-1)||a.name.localeCompare(b.name,'zh'));
  function aggregate(items,date){
    let total=0,known=0,coverageWeight=0,favorable=0,prod=0,area=0,coveredProd=0,coveredArea=0,validCount=0,partialCount=0;
    let lowSum=0,mediumSum=0,highSum=0,componentWeight=0;
    for(const r of items){
      const w=weight(r);if(Number.isFinite(w)&&w>=0)total+=w;
      const d=byDate(r,date),share=eligibleShare(d);if(!Number.isFinite(share))continue;validCount++;
      const sampleCoverage=Number.isFinite(d.covered_point_weight_share)?d.covered_point_weight_share:1;
      if(Number.isFinite(w)&&w>0){known+=w;coverageWeight+=w*sampleCoverage;favorable+=w*share;const c=components(d);if([c.low,c.medium,c.high].every(Number.isFinite)){componentWeight+=w;lowSum+=w*c.low;mediumSum+=w*c.medium;highSum+=w*c.high;}}
      if(sampleCoverage<.9999){partialCount++;continue;}
      if(Number.isFinite(r.reference?.production_tons)){coveredProd+=r.reference.production_tons;prod+=r.reference.production_tons*share;}
      if(Number.isFinite(r.reference?.tappable_area_ha)){coveredArea+=r.reference.tappable_area_ha;area+=r.reference.tappable_area_ha*share;}
    }
    return {share:known?favorable/known:null,coverage:total?coverageWeight/total:null,low:componentWeight?lowSum/componentWeight:null,medium:componentWeight?mediumSum/componentWeight:null,high:componentWeight?highSum/componentWeight:null,prod:coveredProd?prod:null,area:coveredArea?area:null,coveredProd,coveredArea,validCount,partialCount,totalCount:items.length};
  }
  function average(items,date,count){const dates=(data.countries?.[0]?.daily||[]).map(d=>d.date),i=dates.indexOf(date);if(i<count-1)return null;const values=dates.slice(i-count+1,i+1).map(d=>aggregate(items,d).share);return values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0)/count:null;}
  function favorableAmount(a){return state.basis==='production'&&Number.isFinite(a.prod)?'情景对应参考产量 '+fmt(a.prod/10000,2)+' 万吨':state.basis==='area'&&Number.isFinite(a.area)?'情景对应参考可割面积 '+fmt(a.area,0)+' 公顷':'';}
  function adverseAmount(a){return state.basis==='production'&&Number.isFinite(a.prod)?'情景外参考产量 '+fmt((a.coveredProd-a.prod)/10000,2)+' 万吨':state.basis==='area'&&Number.isFinite(a.area)?'情景外参考可割面积 '+fmt(a.coveredArea-a.area,0)+' 公顷':'';}
  function rateOf(r,dates=state.panel==='matrix'?monthDates(state.year,Number(state.month),true):datesInView()){const values=dates.map(date=>eligibleShare(byDate(r,date))).filter(Number.isFinite);return values.length?values.reduce((n,d)=>n+d,0)/values.length:-1;}
  function aggregateScope(items,date,item=scopeItem()){const payload=historyPayload(itemId(item)+'|'+date.slice(0,4)),rows=payload?.daily_by_basis?.[state.basis],day=indexedDay(rows,date),fallback=state.panel==='trend'&&day?{}:aggregate(items,date);if(!day){if(data.schema_version>=4&&state.basis==='sample'&&item&&!item.name)return {...fallback,share:null,coverage:null,low:null,medium:null,high:null};return fallback;}const c=components(day);return {...fallback,share:eligibleShare(day),coverage:day.covered_reference_weight_share??day.covered_point_weight_share,low:c.low,medium:c.medium,high:c.high};}
  function options(items,value){return items.map(([id,label])=>`<option value="${escape(id)}"${id===value?' selected':''}>${escape(label)}</option>`).join('');}
  function renderShell(){
    const latest=data.date_range.end;state.date=latest;state.year=Number(latest.slice(0,4));state.years=availableYears().slice(-10);
    host.innerHTML=`<div class="tb-heading"><div><span class="tb-eyebrow">PRODUCTION WEATHER · 天气条件诊断</span><h2>割胶天气评估</h2><p class="tb-note">按当地研究窗口的小时降雨评估天气干扰，不等同于实际开割、可割天数或减产量。</p></div><div class="tb-source-stamp"><b>历史再分析</b><span>历史导出截止 ${escape(latest)}</span></div></div>
      <div class="tb-controls"><label>国家 / 区域<select id="tb-country"></select></label><label>产区大区<select id="tb-group"></select></label><label>产区<select id="tb-region"></select></label><label>汇总权重<select id="tb-basis"></select></label><label>搜索产区<input id="tb-search" placeholder="输入产区名称"></label></div>
      <div class="tb-assessment"><div><span class="tb-field-title">评估情景</span><div class="tb-segment" role="group" aria-label="天气条件情景"><button type="button" data-tb-scenario="strict">仅无明显干扰 <small>严格</small></button><button type="button" data-tb-scenario="inclusive">含中等干扰 <small>宽松</small></button></div></div><label class="tb-window">近期观察窗口<select id="tb-window">${options([1,7,14,30,60,90].map(n=>[String(n),n===1?'最近一天':n+'天']),String(state.window))}</select></label><p class="tb-note" id="tb-scenario-note"></p></div>
      <p class="tb-note" id="tb-reference"></p><div class="tb-cards" id="tb-cards"></div>
      <section class="tb-panel tb-trend-panel"><div class="tb-section-heading"><div><h3>降雨干扰结构与天气条件趋势</h3><p class="tb-note" id="tb-trend-note"></p></div><label class="tb-date-control">详情日期<select id="tb-date"></select></label></div><div id="tb-timeline" class="tb-trend-chart" aria-label="降雨干扰等级和完整度时间趋势"></div><p class="tb-note">三个色带表示已知样本中各干扰等级的比例；虚线表示参考权重的数据完整度。点击日期可联动下方详情。观察跨度不是割胶制度周期。</p></section>
      <section class="tb-panel"><div class="tb-section-heading"><div><h3 id="tb-day-title"></h3><p class="tb-note" id="tb-day-note"></p></div><span class="tb-badge" id="tb-day-scenario"></span></div><div class="tb-split" id="tb-day-columns"><div><h4 class="tb-low" id="tb-good-title"></h4><div id="tb-good" class="tb-region-list"></div></div><div><h4 class="tb-high" id="tb-bad-title"></h4><div id="tb-bad" class="tb-region-list"></div></div><div id="tb-missing-column" hidden><h4 class="tb-unknown">数据不足，暂不评估</h4><div id="tb-missing" class="tb-region-list"></div></div></div><p class="tb-note">先逐格点判定，再按格点权重汇总；不将全区平均雨量重新分级。区域提示等级：较高干扰权重达到50%时提示较高，否则中等＋较高达到25%时提示中等，其余提示无明显干扰。25%/50%只是展示门槛，不是官方停割标准；请同时看三类占比。雨量及有雨小时是样本加权均值，有雨小时不是全产区统一持续时长，格点占比也不是已核实的全府胶园覆盖比例。</p></section>
      <section class="tb-panel tb-forecast-panel"><div class="tb-section-heading"><div><span class="tb-eyebrow">MODEL FORECAST · 独立预报</span><h3>割胶时段预报 · 降雨量范围</h3></div><span class="tb-badge">不生成预报“有雨小时数”</span></div><div id="tb-forecast"></div></section>
      <details class="tb-panel tb-data-fold"><summary><span>产区逐日评估矩阵</span><small id="tb-daily-subtitle"></small></summary><div class="tb-controls"><label>排序<select id="tb-sort"><option value="production">参考产量从高到低</option><option value="rate">情景对应样本比例从高到低</option></select></label></div><div class="tb-legend"><span><i style="background:${colors.low}"></i>无明显干扰</span><span><i style="background:${colors.medium}"></i>中等干扰</span><span><i style="background:${colors.high}"></i>较高干扰</span><span><i style="background:${colors.unknown}"></i>数据不足</span></div><div class="tb-table-wrap" id="tb-daily-table"></div></details>
      <details class="tb-panel tb-data-fold"><summary><span id="tb-month-title"></span><small>逐产区与汇总地区</small></summary><div class="tb-controls"><label>年份<select id="tb-year"></select></label></div><p class="tb-note">* 表示月份未结束或缺测，仅计已覆盖日期；缺测不计为无雨。色块按完整月份条件日占比呈现，避免固定天数阈值混淆长短月份。</p><div class="tb-table-wrap" id="tb-month-table"></div></details>
      <section class="tb-panel tb-comparison-panel"><div class="tb-section-heading"><div><h3 id="tb-comparison-title"></h3><p class="tb-note">自由选择年份，对比历史同月天气条件。</p></div><span class="tb-badge" id="tb-comparison-weight"></span></div><div class="tb-controls"><label>产区 / 大区<select id="tb-comparison"></select></label><label>国家 / 大区汇总权重<select id="tb-comparison-basis"></select></label></div><div class="tb-year-picker"><div class="tb-year-actions"><span>对比年份</span><button type="button" data-tb-years="5">近5年</button><button type="button" data-tb-years="10">近10年</button><button type="button" data-tb-years="all">全部年份</button><button type="button" data-tb-years="none">清空</button></div><div id="tb-years" class="tb-years"></div></div><p class="tb-note" id="tb-comparison-note"></p><div class="tb-chart-wrap"><div id="tb-comparison-chart"></div></div><div class="tb-table-wrap" id="tb-comparison-table"></div></section>
      <details class="tb-fold"><summary>判断规则、数据来源与局限</summary><div id="tb-method"></div><p>ERA5-Land是历史再分析，不是胶园雨量站实测。雨量时间戳为前1小时雨量的结束时刻，按小时起点（减1小时）转当地时区。印度、缅甸等半小时时区窗口边缘仍为小时近似。</p><p>参考年产量与可割面积乘天气比例，只用于比较生产分布对应的天气暴露，不是当日可生产量或实际损失。未知格点不按无雨处理；单格点仅代表该样本。无完整胶园覆盖的国家样本不能外推全国胶园面积。</p></details>`;
    for(const [key,panel] of Object.entries(panels)){panel.follow=true;panel.scope={};panel.time={year:state.year,month:Number(latest.slice(5,7)),day:Number(latest.slice(8,10)),date:latest,years:availableYears().slice(-10)};if(key==='monthly')panel.time.month='all';}
    installLocalPanels();
    document.getElementById('tb-country').innerHTML=options(countryOptions(),state.country);
    for(const [id,key] of [['tb-country','country'],['tb-group','group'],['tb-region','region'],['tb-basis','basis'],['tb-window','window']])document.getElementById(id).addEventListener('change',e=>{state[key]=key==='window'?Number(e.target.value):e.target.value;if(key==='country'){state.group='all';state.region='all';state.search='';document.getElementById('tb-search').value='';}if(key==='group')state.region='all';refreshSelectors();render();});
    document.getElementById('tb-search').addEventListener('input',e=>{state.search=e.target.value;refreshSelectors();render();});
    host.addEventListener('click',e=>{const sync=e.target.closest('[data-tb-sync]');if(sync){setPanelFollow(sync.dataset.tbSync,true);render();return;}const b=e.target.closest('[data-tb-date]');if(b){setDiagnosisDate(b.dataset.tbDate,b.dataset.tbOrigin,b.dataset.tbRegion);render();}const s=e.target.closest('[data-tb-scenario]');if(s){state.scenario=s.dataset.tbScenario;render();}const y=e.target.closest('[data-tb-years]');if(y){const all=availableYears(),n=y.dataset.tbYears;panels.comparison.time.years=n==='all'?all:n==='none'?[]:all.slice(-Number(n));render();}});
    host.addEventListener('change',e=>{const target=e.target,wrapper=target.closest('[data-tb-component]');if(target.dataset.tbFollow){setPanelFollow(target.dataset.tbFollow,target.checked);render();return;}if(wrapper){const key=wrapper.dataset.tbComponent,panel=panels[key],field=target.dataset.tbScope;if(field)setLocalScope(key,field,target.value);const time=target.dataset.tbTime;if(time){panel.time[time]=['year','day'].includes(time)||time==='month'&&target.value!=='all'?Number(target.value):target.value;if(key==='diagnosis'){const lastDay=new Date(Date.UTC(panel.time.year,panel.time.month,0)).getUTCDate();panel.time.day=Math.min(panel.time.day,lastDay);panel.time.date=panel.time.year+'-'+String(panel.time.month).padStart(2,'0')+'-'+String(panel.time.day).padStart(2,'0');}}render();return;}if(target.matches('[data-tb-year]')){const year=Number(target.dataset.tbYear),p=panels.comparison.time;p.years=target.checked?[...new Set([...p.years,year])].sort((a,b)=>a-b):p.years.filter(y=>y!==year);render();}});
    refreshSelectors();render();
  }
  function installLocalPanels(){
    const anchors={trend:'tb-timeline',diagnosis:'tb-day-title',matrix:'tb-daily-table',monthly:'tb-month-table',comparison:'tb-comparison-chart',forecast:'tb-forecast'};
    for(const [key,id] of Object.entries(anchors)){const panel=document.getElementById(id).closest('.tb-panel');panel.querySelectorAll('.tb-controls,.tb-date-control').forEach(node=>node.remove());const heading=panel.querySelector(':scope > summary,:scope > .tb-section-heading');(heading||panel).insertAdjacentHTML(heading?'afterend':'afterbegin',`<div id="tb-${key}-controls"></div><p id="tb-${key}-history" class="tb-note"></p>`);if(key==='matrix'||key==='monthly')panel.open=true;}
    const old=document.getElementById('tb-forecast').closest('.tb-panel'),fold=document.createElement('details');fold.className='tb-panel tb-data-fold tb-forecast-panel';fold.innerHTML='<summary><span>ECMWF 独立窗口预报</span><small>原生3/6小时 · 不计历史条件日数</small></summary>'+old.innerHTML;old.remove();host.appendChild(fold);
  }
  function refreshSelectors(){
    if(!['all','overlap_details'].includes(state.group)&&!groups().some(g=>g.group_id===state.group)){state.group='all';state.region='all';}
    document.getElementById('tb-group').innerHTML=options([['all','全部大区'],...groups().map(g=>[g.group_id,g.label]),...(overlappingDetails().length?[['overlap_details','重叠县级样本（仅详情）']]:[])],state.group);
    const people=candidates(),bases=basisOptions();if(state.region!=='all'&&!people.some(r=>r.id===state.region))state.region='all';document.getElementById('tb-region').innerHTML=options([['all','全部产区'],...people.map(r=>[r.id,r.name])],state.region);
    if(!bases.some(b=>b[0]===state.basis))state.basis=bases[0][0];document.getElementById('tb-basis').innerHTML=options(bases,state.basis);
  }
  function render(){
    renderCards();
    for(const key of Object.keys(panels))withPanel(key,()=>{
      let extras='';
      if(['trend','diagnosis','matrix','monthly'].includes(key))extras+=yearSelect(key);
      if(['diagnosis','matrix','monthly'].includes(key))extras+=monthSelect(key,key==='monthly');
      if(key==='diagnosis'){const length=new Date(Date.UTC(state.year,Number(state.month),0)).getUTCDate();extras+=timeSelect(key,'day','日期',Array.from({length},(_,i)=>[String(i+1),i+1+'日']),state.day||Number(state.date.slice(8,10)));}
      if(key==='matrix')extras+=timeSelect(key,'sort','排序',[['production','参考产量从高到低'],['rate','情景对应比例从高到低']],state.sort);
      document.getElementById('tb-'+key+'-controls').innerHTML=localControls(key,extras);
      const subset=filtered();
      if(key==='trend'){const dates=yearDates(Number(state.year));document.getElementById('tb-trend-note').textContent=`${state.year}年 · ${dates[0]||'—'} 至 ${dates.at(-1)||'—'} · ${basisNames[state.basis]} · ${scenarioName()}；滑条只浏览所选年度。`;renderTrend(subset,dates);}
      if(key==='diagnosis')renderDiagnosis(subset);
      if(key==='matrix'){const dates=monthDates(state.year,Number(state.month));document.getElementById('tb-daily-subtitle').textContent=`${state.year}年${state.month}月 · ${dates.length} 个日历日 · 尚未发布的日期留空，整月与顶部窗口独立`;renderDaily(dates);}
      if(key==='monthly'){document.getElementById('tb-month-title').textContent='月度'+conditionName();renderMonthly();}
      if(key==='comparison'){document.getElementById('tb-comparison-title').textContent='月度天气条件 · 自选年度对比';state.comparison=itemId(scopeItem());state.years=panels.comparison.time.years||availableYears().slice(-10);renderComparison();}
      if(key==='forecast')renderForecast();
      historyMessage(key);
    });
    const staged=data.regions.some(r=>r.daily?.some(d=>'stage_03_05_level' in d));
    const rule=staged?'采用当地 03:00–05:00 与 05:00–07:00 两阶段研究窗口。03–05 两小时雨量均 <0.2 mm 为无明显干扰；均 ≥0.2 mm 或合计 ≥5 mm 为较高干扰，其余为中等。05–07 合计 <0.5 mm 为无明显干扰，≥5 mm 为较高干扰，其余为中等。每日等级取两阶段较高者，须有完整四小时数据。00–03、前日18–00、07–09只展示背景，不直接改变等级。':revisedWindows()?'当前载入旧规则导出：03–07 雨量 ≥1 mm 或有雨 ≥2小时为较高干扰；清晨或00–03有阈值雨为中等。请运行更新程序生成两阶段新规则；不能只改页面文字而沿用旧等级。':'当前仍是旧窗口导出，请运行每日更新程序重算历史评估。';
    document.getElementById('tb-method').innerHTML=`<p>${escape(rule)} 这些是用户参考的分时段研究假设，须用胶园作业记录校准；不是官方停割标准，也不是实际可割天数或减产量。03–05两小时各0.2 mm判较高、05–07同总量0.4 mm判无明显干扰，体现不同阈值假设，不表示已证实的生理差异。00–03与夜雨仍可能影响割面干燥，目前只保留背景，不直接纳入等级。地区显示等级来自格点类别分量，不将平均雨量重新套点位阈值。有雨小时区间数按每小时累计≥0.2 mm检出，不能推断小时内下雨几分钟，也不表示连续降雨时长；地区数值是样本加权均值。</p><p>顶部最近一天及7/14/30/60/90天同步影响所有近期卡片。首张始终为所选国家总体（海南/云南按对应区域），不受大区、产区或搜索缩窄；其余按大区或单产区选择展示。多日卡片为同一截止日向前的逐日比例平均，不是累计产量。各模块国家、大区、产区、权重与情景默认跟随全局；局部调整自动独立，可恢复同步。日期与年份始终各模块独立。趋势滑条只覆盖所选年度，月度矩阵直接展示所选自然月；缺测不当作无雨。</p>`;
    scheduleHistory();
  }
  function renderCards(){
    const all=countryMembers(),dates=datesInView();
    const references=all.filter(r=>r.reference),years=[...new Set(references.map(r=>r.reference.year).filter(Boolean))],totalProd=references.reduce((n,r)=>n+(r.reference.production_tons||0),0),totalArea=references.reduce((n,r)=>n+(r.reference.tappable_area_ha||0),0);
    const referenceBits=[totalProd>0?`${fmt(totalProd/10000,2)} 万吨参考产量`:'',totalArea>0?`${fmt(totalArea,0)} 公顷参考可割面积`:''].filter(Boolean);
    document.getElementById('tb-reference').textContent=referenceBits.length?`${names[state.country]||data.countries.find(c=>c.country_iso3===countryIso())?.label} · ${years.join('/')}年参考口径 · ${referenceBits.join(' / ')} · 已匹配 ${references.length} 个地区。`:'暂无匹配的产量或可割面积，采用地区样本等权；不表示全国胶园面积加权。';
    if(state.country==='IND')document.getElementById('tb-reference').textContent+=' 全国仅纳入 Kerala 母州与其他州，5个重叠县级样本仅详情展示，避免重复计算。';
    host.querySelectorAll('[data-tb-scenario]').forEach(b=>{b.classList.toggle('is-active',b.dataset.tbScenario===state.scenario);b.setAttribute('aria-pressed',String(b.dataset.tbScenario===state.scenario));});
    document.getElementById('tb-scenario-note').textContent=(state.scenario==='inclusive'?'宽松敏感性情景：计入中等干扰，仅作阈值比较，不代表实际可以割胶。':'严格情景：仅纳入无明显降雨干扰，仍需结合树皮干燥、雨挡与休割制度。')+' 所有卡片按观察窗口同步；首张固定国家总体。最近一天指最新历史再分析日，不是今天的预报。搜索只筛选成员列表，下方图表时间独立。';
    const period=state.window===1?'最近一天 · '+(dates.at(-1)||'—'):'近'+state.window+'日平均 · '+(dates[0]||'—')+'—'+(dates.at(-1)||'—');
    document.getElementById('tb-cards').innerHTML=cardScopes().map(scope=>{
      const a=cardWindowSummary(scope,dates),amount=favorableAmount(a),weighting=scope.item?.name?'本区格点分量':basisNames[state.basis];
      const availability=a.knownDays<dates.length?`<br>可评估 ${a.knownDays}/${dates.length} 日；未以无雨补齐`:a.partialDays?`<br>${a.partialDays} 日仅有部分样本；比例基于已知样本`:'';
      return `<div class="tb-card${scope.national?' is-country':''}"><small>${escape(scope.title)}</small><small class="tb-card-period">${escape(period)}</small><strong>${percent(a.share)}</strong><small>${escape(scenarioName())}<br>${escape(weighting)}<br>${state.window===1?'数据完整度':'窗口平均数据完整度'} ${percent(a.coverage)}${availability}${amount?`<br>${state.window>1?'日均':''}${amount}`:''}</small></div>`;
    }).join('');
  }
  function renderDiagnosis(subset){
    const agg=aggregateScope(rangeRegions(),state.date);document.getElementById('tb-day-title').textContent=state.date+' · 产区窗口诊断';document.getElementById('tb-day-scenario').textContent=scenarioName();
    document.getElementById('tb-day-note').textContent=`情景对应比例 ${percent(agg.share)}；参考权重数据完整度 ${percent(agg.coverage)}。${favorableAmount(agg)?favorableAmount(agg)+'；'+adverseAmount(agg)+'。':''}${agg.partialCount?' '+agg.partialCount+' 个地区的格点未全部完整，当量仅纳入完整地区。':''}`;
    const buckets={good:[],bad:[],missing:[]};for(const r of sorted()){const d=byDate(r,state.date);buckets[!d||d.risk_level==='unknown'?'missing':eligibleRegion(d)?'good':'bad'].push({r,d});}
    document.getElementById('tb-good-title').textContent=state.scenario==='inclusive'?'无明显干扰 / 中等干扰地区':'无明显干扰地区';document.getElementById('tb-bad-title').textContent=state.scenario==='inclusive'?'较高干扰地区':'中等 / 较高干扰地区';
    const missing=buckets.missing.length>0||agg.partialCount>0;document.getElementById('tb-missing-column').hidden=!missing;document.getElementById('tb-day-columns').classList.toggle('has-missing',missing);
    for(const key of Object.keys(buckets))document.getElementById('tb-'+key).innerHTML=buckets[key].map(({r,d})=>regionRow(r,d)).join('')||'<p class="tb-note">此范围暂无地区</p>';
    if(missing&&!buckets.missing.length)document.getElementById('tb-missing').innerHTML='<p class="tb-note">部分地区仅有部分格点完整，未覆盖格点不计为无雨。已知格点参与比例诊断，当量不外推缺测地区。</p>';
  }
  function regionRow(r,d){
    const preMm=d?.pre_dawn_rain_mm??d?.previous_night_rain_mm,preHours=d?.pre_dawn_rain_hours??d?.previous_night_rain_hours,triggers=d?.trigger_shares,newRules=data.schema_version>=4||d&&'stage_03_05_level' in d,triggerNames={dawn_heavy:'阶段雨量或有雨小时区间触发',dawn_wet:'研究窗口有阈值雨',pre_dawn_wet:'割前窗口有阈值雨'};
    const causes=triggers?Object.entries(triggers).filter(([key,v])=>Number.isFinite(v)&&v>0&&(!newRules||key!=='pre_dawn_wet')).map(([key,v])=>`${triggerNames[key]||key} ${percent(v)}`).join('；'):'',revised=revisedWindows();
    const stageLabels={low:'无明显干扰',medium:'中等干扰',high:'较高干扰',unknown:'数据不足'},staged=d&&'stage_03_05_level' in d;
    const stages=staged?['03_05','05_07'].map(stage=>`<span>研究时段 ${stage.replace('_','–')}<b>${fmt(d['stage_'+stage+'_rain_mm'],2)} mm / ${fmt(d['stage_'+stage+'_rain_hours'],2)} 有雨小时 · ${escape(stageLabels[d['stage_'+stage+'_level']]||'数据不足')}</b></span>`).join(''):'';
    return `<article class="tb-region-row"><div class="tb-region-top"><strong>${escape(r.name)}</strong><span>${Number.isFinite(r.reference?.production_tons)?fmt(r.reference.production_tons/10000,2)+' 万吨':'无参考产量'}</span></div><small>${escape(r.group_label||'')}</small><div class="tb-window-values">${stages}<span>${revised?'割胶 03–07':'清晨窗口'}<b>${fmt(d?.dawn_rain_mm,2)} mm / ${fmt(d?.dawn_rain_hours,2)} 有雨小时</b></span><span>${staged?'背景 00–03':revised?'割前 00–03':'前置窗口'}<b>${fmt(preMm,2)} mm / ${fmt(preHours,2)} 有雨小时</b></span></div><p class="tb-reason">${escape(d?.reason||'所选日小时窗口不足，暂不评估')}</p>${causes?`<p class="tb-trigger">触发条件对应格点权重：${escape(causes)}</p>`:''}${Number.isFinite(d?.adverse_share)?`<small>格点分量：无明显干扰 ${percent(components(d).low)} / 中等 ${percent(components(d).medium)} / 较高 ${percent(components(d).high)}</small>`:''}${Number.isFinite(d?.previous_evening_rain_mm)||Number.isFinite(d?.post_tapping_rain_mm)?`<details class="tb-background"><summary>其他时段背景（不直接纳入等级，仍需关注割面湿润）</summary><small>前日18–00 ${fmt(d.previous_evening_rain_mm,2)} mm / ${fmt(d.previous_evening_rain_hours,2)}小时；07–09 ${fmt(d.post_tapping_rain_mm,2)} mm / ${fmt(d.post_tapping_rain_hours,2)}小时</small></details>`:''}</article>`;
  }
  function renderTrend(items,dates){
    const plot=document.getElementById('tb-timeline'),values=dates.map(d=>aggregateScope(items,d));
    if(!window.Plotly){plot.innerHTML=dates.map((d,i)=>`<button type="button" class="tb-fallback-date" data-tb-date="${d}">${d.slice(5)} ${percent(values[i].share)}</button>`).join('');return;}
    const traces=[['low','无明显干扰'],['medium','中等干扰'],['high','较高干扰']].map(([key,name])=>({type:'scatter',mode:'lines',x:dates,y:values.map(a=>a[key]===null?null:a[key]*100),name,stackgroup:'severity',line:{width:1.2,color:colors[key]},fillcolor:colors[key]+'55',hovertemplate:name+' %{y:.1f}%<extra></extra>',connectgaps:false}));
    traces.push({type:'scatter',mode:'lines+markers',name:'当前情景对应比例',x:dates,y:values.map(a=>a.share===null?null:a.share*100),line:{color:'#213e35',width:2.2},marker:{size:dates.length<=30?4:2},hovertemplate:'当前情景 %{y:.1f}%<extra></extra>',connectgaps:false},{type:'scatter',mode:'lines',name:'参考权重数据完整度',x:dates,y:values.map(a=>a.coverage===null?null:a.coverage*100),line:{color:'#777f8c',width:1.5,dash:'dot'},hovertemplate:'数据完整度 %{y:.1f}%<extra></extra>',connectgaps:false});
    const bounds=dates.length?[dates[0],dates.at(-1)]:undefined,revision=[state.year,state.country,state.group,state.region].join('|');
    // Keep the legend above the plot; the range slider owns the compact bottom area.
    Plotly.react(plot,traces,{autosize:true,uirevision:revision,margin:{l:44,r:18,t:48,b:18},font:{family:'Microsoft YaHei, sans-serif',size:11,color:'#657a71'},paper_bgcolor:'transparent',plot_bgcolor:'#fff',hovermode:'x unified',legend:{orientation:'h',traceorder:'normal',x:0,y:1.04,yanchor:'bottom'},xaxis:{type:'date',uirevision:revision,range:bounds,gridcolor:'#edf1ef',tickformat:'%m-%d',zeroline:false,rangeslider:{visible:true,range:bounds,thickness:.12}},yaxis:{range:[0,103],ticksuffix:'%',gridcolor:'#edf1ef',zeroline:false},shapes:[{type:'line',x0:state.date,x1:state.date,y0:0,y1:1,yref:'paper',line:{color:'#637e72',width:1,dash:'dash'}}]},{responsive:true,displaylogo:false,modeBarButtonsToRemove:['lasso2d','select2d']});
    if(!plot.dataset.clickBound){plot.on('plotly_click',event=>{const date=String(event.points?.[0]?.x||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=data.date_range.end){setDiagnosisDate(date,'trend');render();}});plot.dataset.clickBound='1';}
  }
  function renderDaily(dates){
    const heading=`<tr><th>#</th><th>产区</th><th>大区</th><th class="tb-num">参考产量（万吨）</th><th class="tb-num">产量占比</th><th class="tb-num">格点数</th><th class="tb-num">情景对应比例</th><th>${dates.length}日主等级<div class="tb-strip tb-strip-days">${dates.map(date=>`<span>${date.slice(8)}</span>`).join('')}</div></th></tr>`;
    const rows=sorted().map((r,i)=>{const rate=rateOf(r,dates),strip=dates.map(date=>{const d=byDate(r,date),risk=d?.risk_level||'unknown',reason=d?.reason||(date>data.date_range.end?'历史数据尚未发布':'数据不足');return `<button class="tb-dot ${risk}" data-tb-date="${date}" data-tb-origin="matrix" data-tb-region="${escape(r.id)}" title="${escape(r.name+' '+date+' '+reason)}" aria-label="${escape(r.name+' '+date+' '+reason)}"></button>`;}).join('');return `<tr><td>${i+1}</td><td>${escape(r.name)}</td><td>${escape(r.group_label||'—')}</td><td class="tb-num">${fmt(Number.isFinite(r.reference?.production_tons)?r.reference.production_tons/10000:null,2)}</td><td class="tb-num">${percent(r.reference?.production_share)}</td><td class="tb-num">${r.point_count}</td><td class="tb-num">${rate>=0?percent(rate):'—'}</td><td><div class="tb-strip">${strip}</div></td></tr>`;}).join('');
    document.getElementById('tb-daily-table').innerHTML=`<table class="tb-table"><thead>${heading}</thead><tbody>${rows}</tbody></table>`;
  }
  const archive=item=>item?.monthly_archive_by_basis ? (item.monthly_archive_by_basis[state.basis]||[]) : (item?.monthly_archive||[]);
  const monthly=(item,year,month)=>archive(item).find(x=>x.month===year+'-'+String(month).padStart(2,'0'));
  function monthValue(row,equivalent){if(!row?.known_days)return null;if(state.scenario==='strict')return equivalent?row.favorable_equivalent_days:row.low_risk_days;if(equivalent)return row.inclusive_equivalent_days;return Number.isFinite(row.inclusive_condition_days)?row.inclusive_condition_days:Number.isFinite(row.low_risk_days)&&Number.isFinite(row.medium_risk_days)?row.low_risk_days+row.medium_risk_days:null;}
  function monthCell(item,year,month,equivalent=false){const row=monthly(item,year,month),value=monthValue(row,equivalent);if(!Number.isFinite(value))return '<td class="tb-month na tb-num">—</td>';const partial=!row.complete_observations,ratio=value/row.calendar_days;return `<td class="tb-month ${partial?'partial':ratio>=.85?'good':ratio>=.65?'medium':'bad'} tb-num" title="${escape(row.period_start+'—'+row.period_end+'；已知'+row.known_days+'/'+row.calendar_days+'日；'+scenarioName())}">${fmt(value,equivalent?1:0)}${partial?' *':''}</td>`;}
  function renderMonthly(){
    const rows=sorted(),group=currentGroup(),months=state.month==='all'||!state.month?Array.from({length:12},(_,i)=>i+1):[Number(state.month)],header='<th>产区 / 大区</th><th>参考产量（万吨）</th>'+months.map(m=>`<th class="tb-num">${m}月</th>`).join('')+'<th class="tb-num">所选月份已覆盖合计</th>';
    const aggregateRows=state.region&&state.region!=='all'?[]:[group,...(state.group==='all'?groups().filter(g=>itemId(g)!==itemId(group)):[])].filter(Boolean);
    function rowHtml(r,equivalent){const records=months.map(m=>monthly(r,state.year,m)).filter(Boolean),values=records.map(x=>monthValue(x,equivalent)).filter(Number.isFinite),sum=values.reduce((n,v)=>n+v,0),production=r.reference?.production_tons??r.reference_production_tons;return `<tr class="${equivalent?'tb-aggregate-row':'tb-member-row'}"><td>${escape(r.name||r.label)}${equivalent?'（等效；'+escape(basisNames[state.basis])+'）':''}</td><td class="tb-num">${fmt(Number.isFinite(production)?production/10000:null,2)}</td>${months.map(m=>monthCell(r,state.year,m,equivalent)).join('')}<td class="tb-num">${values.length?fmt(sum,equivalent?1:0):'—'}</td></tr>`;}
    document.getElementById('tb-month-table').innerHTML=`<table class="tb-table"><thead><tr>${header}</tr></thead><tbody>${aggregateRows.map(r=>rowHtml(r,true)).join('')}${rows.map(r=>rowHtml(r,false)).join('')}</tbody></table>`;
  }
  function currentYear(){return Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric'}).format(new Date()));}
  function yearColor(year,current){const recent=['#FF0000','#000000','#8a73c7','#d89743','#53a382','#608ac8'],offset=current-year;if(offset>=0&&offset<recent.length)return recent[offset];const established={2015:'#8b6fc3',2016:'#4c84bf'};return established[year]||['#648d9c','#b88c56','#789467','#8e7b9d','#5b9a91','#a67972'][(year-2006+60)%6];}
  function comparisonYearStyle(year,current){
    // Calendar-year emphasis matches the climate seasonal charts, not the latest selected/data year.
    const color=yearColor(year,current),isCurrent=year===current,isPrevious=year===current-1;
    return {line:{color,width:isCurrent?3:isPrevious?2.35:1.5,dash:isCurrent||isPrevious?'solid':'dot'},
      marker:{symbol:isCurrent?'square':'circle',color:isCurrent?'#FFF2CC':isPrevious?'#E7E6E6':color,size:isCurrent||isPrevious?6:3,
        line:{color:isCurrent?'#ED7D31':isPrevious?'#000000':color,width:isCurrent||isPrevious?1.25:0}}};
  }
  function forecastEntity(){
    const payload=forecastData||window.rubberForecastData;if(!payload?.entities)return null;
    const item=scopeItem(),id=itemId(item)||'g_country_'+countryIso();
    return payload.entities[id]||null;
  }
  function forecastRows(entity){return (entity?.daily||[]).filter(day=>day.source_type==='forecast'&&day.date>(entity.historical_through||data.date_range.end));}
  function rainRange(windowRain){
    if(!windowRain||!Number.isFinite(windowRain.min_mm)||!Number.isFinite(windowRain.max_mm))return '暂无完整窗口';
    if(!windowRain.complete)return '时段 / 样本未完整'+(Number.isFinite(windowRain.covered_hours)?'（已知样本覆盖'+fmt(windowRain.covered_hours,1)+'小时）':'');
    const range=Math.abs(windowRain.max_mm-windowRain.min_mm)<.005?fmt(windowRain.min_mm,2):fmt(windowRain.min_mm,2)+'–'+fmt(windowRain.max_mm,2);
    return range+' mm';
  }
  function forecastWeightLabel(entity){
    const known={user_workbook_F_harvestable_area_ha_unverified:'用户表可收割面积加权（原统计未核验）',equal_sampled_regions_no_complete_harvest_area:'已采样地区等权（不是全国面积）',model_or_polygon_selected_cell_share:'区域模型 / 边界采样格点权重',within_region_weight_from_source_links:'区域来源格点权重',equal_points_no_source_weight:'采样格点等权'};
    return entity?.aggregation_basis_label||entity?.weighting_label||known[entity?.weight_basis]||'气候图固定汇总口径';
  }
  function renderForecast(){
    const box=document.getElementById('tb-forecast');if(!box)return;
    const entity=forecastEntity(),rows=forecastRows(entity),cutoff=entity?.historical_through||data.date_range.end,gap=rows.length&&rows[0].date>nextDate(cutoff);
    if(!rows.length){box.innerHTML='<p class="tb-note">当前选择范围暂无可用独立预报。历史再分析仍截止 '+escape(data.date_range.end)+'；未覆盖日期保持缺口，不当作无雨，也不以预报回填历史。</p>';return;}
    const weighting=forecastWeightLabel(entity);
    box.innerHTML=`<p class="tb-note">预报对象：${escape(entity.name||'所选范围')} · ${escape(weighting)}。此范围历史再分析截至 ${escape(cutoff)}；以下为 ECMWF 模型预报，再分析发布后按日期优先展示再分析。${gap?' 历史截止与首个可用预报之间存在未覆盖日期，明确留空。':''}</p><p class="tb-forecast-scope">历史评估当前使用 ${escape(basisNames[state.basis])} · ${escape(scenarioName())}；本预报固定采用气候图口径，不随历史权重、严格 / 宽松情景或搜索过滤切换，两者不能当作同权重的干扰率比较。</p><div class="tb-table-wrap"><table class="tb-table"><thead><tr><th>当地日期</th><th>割胶03–07降雨范围</th><th>割前00–03降雨范围</th><th>窗口覆盖</th><th>模式起报 UTC</th></tr></thead><tbody>${rows.map(day=>`<tr><td>${escape(day.date)} <span class="tb-forecast-label">预测</span></td><td>${escape(rainRange(day.main_window_rain))}</td><td>${escape(rainRange(day.pre_window_rain))}</td><td>${day.main_window_rain?.complete&&day.pre_window_rain?.complete?'完整':'不完整'} · 样本 ${percent(day.sample_coverage)}</td><td>${escape(day.run_utc||'—')}</td></tr>`).join('')}</tbody></table></div><p class="tb-note">ECMWF 原始累计降雨间隔为3小时或6小时，不能均分成真实小时雨量。范围下限为完整落入窗口的区间雨量，上限包含所有与窗口相交的区间；这是时间边界分配范围，不是概率置信区间。不套用历史“有雨≥2小时”规则，不计入历史条件日数、月表和分位点。</p>`;
  }
  function nextDate(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
  function monthComparison(item,years,month,equivalent){
    const latest=Math.max(...years),row=monthly(item,latest,month),value=monthValue(row,equivalent);
    const history=years.filter(year=>year!==latest).map(year=>monthly(item,year,month)).filter(record=>record?.complete_observations&&Number.isFinite(monthValue(record,equivalent)));
    const mean=history.length?history.reduce((sum,record)=>sum+monthValue(record,equivalent),0)/history.length:null;
    const comparable=Boolean(row?.complete_observations&&Number.isFinite(value)&&Number.isFinite(mean));
    const delta=comparable?value-mean:null,tone=!comparable?'none':delta>=.05?'above':delta<=-.05?'below':'equal';
    // A partial latest month is never compared with a historical full month.
    return {latest,row,value,mean,count:history.length,comparable,delta,tone};
  }
  function comparisonDelta(result){return !result.comparable?'':result.tone==='equal'?'≈ 0.0 天':(result.delta>0?'↑ +':'↓ −')+fmt(Math.abs(result.delta),1)+' 天';}
  function latestMonthCell(result,equivalent){
    if(!Number.isFinite(result.value))return '<td class="tb-month na tb-num tb-latest-month">—</td>';
    const partial=!result.row.complete_observations,detail=partial?'未完整 · 不比较':result.comparable?comparisonDelta(result):'无历史参照';
    const title=partial?'本月尚未完整或缺测，不能与历史整月直接比较':result.comparable?`${result.latest}年较其他所选年份完整同月均值${result.tone==='above'?'高':result.tone==='below'?'低':'接近'} ${fmt(Math.abs(result.delta),1)} 天；参照 ${result.count} 年`:'请再选至少一个有完整同月数据的历史年份';
    return `<td class="tb-month tb-latest-month tb-num ${partial?'partial':'tb-delta-'+result.tone}" title="${escape(title)}"><b>${fmt(result.value,equivalent?1:0)}${partial?' *':''}</b><span class="tb-month-delta">${escape(detail)}</span></td>`;
  }
  function renderComparison(){
    const item=[...data.regions,...data.groups,...data.countries].find(x=>(x.id||x.group_id)===state.comparison);if(!item){document.getElementById('tb-comparison-table').innerHTML='<p class="tb-empty">请选择单个产区或非重叠的大区汇总。</p>';const plot=document.getElementById('tb-comparison-chart');if(window.Plotly)Plotly.purge(plot);return;}const equivalent=!item.name,years=state.years.slice().sort((a,b)=>a-b),current=currentYear();
    document.getElementById('tb-years').innerHTML=availableYears().map(y=>`<label><input type="checkbox" data-tb-year="${y}"${years.includes(y)?' checked':''}><span>${y}</span></label>`).join('');
    document.getElementById('tb-comparison-weight').textContent=equivalent?basisNames[state.basis]:'单产区 · 按主等级计数';
    const latest=years.length?years.at(-1):null;
    document.getElementById('tb-comparison-note').textContent=`${item.name||item.label} · ${scenarioName()} · ${equivalent?basisNames[state.basis]+'等效条件日数':'单产区条件日数（不按产量或面积再加权）'}。${latest?`对比年为最新所选的${latest}年，参照均值只用其他已选年份的完整同月，不含对比年自身。`:''}完整月份才纳入线图；未结束或缺测月份以 * 显示，不与历史整月比较。已选 ${years.length} 年。纵轴自动适配曲线，可框选或滚轮缩放，双击恢复自动范围。`;
    const plot=document.getElementById('tb-comparison-chart');
    if(!years.length){document.getElementById('tb-comparison-table').innerHTML='<div class="tb-empty">请勾选至少一个年份。</div>';if(window.Plotly)Plotly.purge(plot);plot.innerHTML='<p class="tb-empty">可任意选择2006年起的多个年度。</p>';return;}
    const months=Array.from({length:12},(_,i)=>i+1),comparisons=months.map(month=>monthComparison(item,years,month,equivalent));
    document.getElementById('tb-comparison-table').innerHTML=`<table class="tb-table"><caption class="tb-comparison-key"><strong>${latest}年 · 与历史同月对比</strong><span class="tb-key-above">↑ 高于均值</span><span class="tb-key-below">↓ 低于均值</span><span class="tb-key-equal">≈ 接近均值</span><small>差值为条件日数，不是产量变化</small></caption><thead><tr><th>月份</th>${years.map(y=>'<th class="tb-num">'+y+(y===latest?'<span class="tb-target-label">对比年</span>':'')+'</th>').join('')}<th class="tb-num">所选历史同月均值<span class="tb-reference-label">不含${latest}年</span></th></tr></thead><tbody>${comparisons.map((result,i)=>`<tr><td>${i+1}月</td>${years.map(y=>y===latest?latestMonthCell(result,equivalent):monthCell(item,y,i+1,equivalent)).join('')}<td class="tb-num tb-reference-mean">${fmt(result.mean)}${result.count?`<small>（${result.count}年）</small>`:''}</td></tr>`).join('')}</tbody></table>`;
    if(!window.Plotly){plot.textContent='图形库尚未载入，请刷新页面。';return;}
    const traces=years.map(year=>({type:'scatter',mode:'lines+markers',name:year+'年',x:months,y:months.map(month=>{const r=monthly(item,year,month);return r?.complete_observations?monthValue(r,equivalent):null;}),...comparisonYearStyle(year,current),customdata:year===latest?comparisons.map(result=>result.comparable?'较历史均值 '+comparisonDelta(result):'无完整历史参照'):undefined,connectgaps:false,hovertemplate:year+'年：%{y:.'+(equivalent?1:0)+'f} 天'+(year===latest?'<br>%{customdata}':'')+'<extra></extra>'}));
    if(comparisons.some(result=>Number.isFinite(result.mean)))traces.push({type:'scatter',mode:'lines',name:'历史同月均值（不含'+latest+'年）',x:months,y:comparisons.map(result=>result.mean),customdata:comparisons.map(result=>result.count),line:{color:'#405d6e',width:2,dash:'dash'},connectgaps:false,hovertemplate:'历史均值 %{y:.1f} 天（%{customdata}年）<extra></extra>'});
    const revision=[state.comparison,state.basis,state.scenario,years.join(',')].join('|');
    Plotly.react(plot,traces,{autosize:true,uirevision:revision,margin:{l:58,r:18,t:10,b:90},font:{family:'Microsoft YaHei, sans-serif',size:11,color:'#657a71'},paper_bgcolor:'transparent',plot_bgcolor:'#fff',hovermode:'x unified',legend:{orientation:'h',traceorder:'reversed',x:.5,xanchor:'center',y:-.22},xaxis:{title:{text:'月份',font:{size:11}},tickmode:'array',tickvals:months,ticktext:months.map(m=>m+'月'),gridcolor:'#e8ede9',zeroline:false},yaxis:{title:{text:equivalent?'等效天气条件日数':'天气条件日数',font:{size:11}},autorange:true,rangemode:'normal',fixedrange:false,gridcolor:'#e8ede9',zeroline:false}},{responsive:true,displaylogo:false,scrollZoom:true,doubleClick:'autosize',modeBarButtonsToRemove:['lasso2d','select2d']});
  }
  async function loadForecast(){try{forecastData=window.rubberForecastData;if(!forecastData){const response=await fetch('data/forecast.json',{cache:'no-store'});if(response.ok)forecastData=await response.json();}if(data)withPanel('forecast',renderForecast);}catch(error){/* An unavailable forecast never changes historical diagnostics. */}}
  async function mount(){host=document.getElementById('tapping-board');if(!host||host.dataset.initialized)return;host.dataset.initialized='1';host.innerHTML='<p class="tb-note">正在读取天气条件与历史月度数据…</p>';try{const response=await fetch('data/tapping.json',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);data=await response.json();if(!data.board)throw Error('请先运行新版 tapping_risk_export.py');renderShell();loadForecast();}catch(error){host.innerHTML='<div class="tb-empty">天气评估数据暂未载入：'+escape(error.message)+'</div>';}}
  if(window.addEventListener)window.addEventListener('rubber-forecast-loaded',()=>{forecastData=window.rubberForecastData;if(data)withPanel('forecast',renderForecast);});
  window.TappingBoard={mount};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
