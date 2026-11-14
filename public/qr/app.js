'use strict';
// Keep the QR secret only in memory; strip it before network requests or rendering.
let qrToken=location.hash.slice(1);
history.replaceState(null,'','/p');
const byId=id=>document.getElementById(id);
const status=byId('status'),panel=byId('location'),exchange=byId('exchange'),refresh=byId('refresh'),logout=byId('logout');
const exchangeKey=crypto.randomUUID();
let active=false,generation=0,busy=false,expiryTimer;
function hide(message){clearTimeout(expiryTimer);generation++;active=false;panel.hidden=true;byId('map').replaceChildren();for(const id of ['lot','place','estimate','time'])byId(id).textContent='';status.textContent=message;refresh.hidden=true;logout.hidden=true;}
async function call(path,options={}){
 const response=await fetch('/api/v1/qr/'+path,{credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',...options});
 if(!response.ok){const error=new Error('request');error.status=response.status;throw error;}
 return response.status===204?null:response.json();
}
async function bootstrap(){return (await call('bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).csrfToken;}
function problem(error){return error.status===429?'요청이 많습니다. 잠시 후 다시 확인하세요.':error.status===503||!error.status?'서버에 연결할 수 없습니다. 잠시 후 다시 확인하세요.':'조회 권한이 만료되었거나 해제되었습니다. 차량에서 새 QR을 발급하세요.';}
function draw(map){
 const root=byId('map');root.replaceChildren();
 if(!map){root.textContent='아직 층을 확인하지 못해 평면도를 표시하지 않습니다.';return;}
 const points=map.zones.flatMap(z=>z.polygon||[]);
 if(!points.length){root.textContent='이 층의 평면도 정보가 없습니다.';return;}
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,height=Math.max(...ys)-minY;
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',[minX-1,minY-1,width+2,height+2].join(' '));svg.setAttribute('role','img');svg.setAttribute('aria-label','선택한 층의 가상 평면도. 선택한 주차면은 녹색으로 표시합니다.');
 const add=(tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));svg.append(el);};
 for(const zone of map.zones)if(zone.polygon)add('polygon',{points:zone.polygon.map(p=>p.x+','+p.y).join(' '),fill:'#eef3ef',stroke:'#c4d2c8','stroke-width':.1});
 for(const p of map.pillars)if(p.center&&p.widthMm&&p.depthMm)add('rect',{x:p.center.x-p.widthMm/2000,y:p.center.y-p.depthMm/2000,width:p.widthMm/1000,height:p.depthMm/1000,fill:'#6c7772',transform:'rotate('+(p.rotationDegrees||0)+' '+p.center.x+' '+p.center.y+')'});
 for(const s of map.spaces)if(s.center&&s.widthMm&&s.lengthMm&&s.headingDegrees!==null)add('rect',{x:s.center.x-s.lengthMm/2000,y:s.center.y-s.widthMm/2000,width:s.lengthMm/1000,height:s.widthMm/1000,fill:s.selected?'#168369':'#fff',stroke:s.selected?'#085340':'#a6b7ac','stroke-width':s.selected?.18:.08,transform:'rotate('+s.headingDegrees+' '+s.center.x+' '+s.center.y+')'});
 root.append(svg);const legend=document.createElement('p');legend.className='legend';legend.textContent='녹색: 선택한 주차면 · 회색: 기둥 · 다른 면의 실제 점유 상태는 모릅니다.';root.append(legend);
}
function render(data){
 clearTimeout(expiryTimer);const remaining=new Date(data.expiresAt).getTime()-Date.now();
 if(remaining<=0){hide('조회 권한이 만료되었습니다. 차량에서 새 QR을 발급하세요.');return;}
 expiryTimer=setTimeout(()=>hide('조회 권한이 만료되었습니다. 차량에서 새 QR을 발급하세요.'),remaining);
 byId('lot').textContent=data.lotName;
 byId('place').textContent=[data.floorLabel||'층 미확정',data.zoneLabel||'구역 미확정',data.parkingSpaceLabel||'주차면 미확정'].join(' · ');
 const confidence={HIGH:'높음',MEDIUM:'중간',LOW:'낮음',UNKNOWN:'미확인'}[data.confidence]||'미확인';
 byId('estimate').textContent='추정 위치 · 원래 신뢰도 '+confidence+(data.userEdited?' · 사용자가 위치를 수정했습니다.':' · 실제 주차 완료를 확인한 정보는 아닙니다.');
 byId('time').textContent='발생 '+new Date(data.occurredAt).toLocaleString('ko-KR')+' · 조회 만료 '+new Date(data.expiresAt).toLocaleString('ko-KR');
 draw(data.map);status.textContent='이 휴대폰에서만 제한된 위치를 확인합니다.';panel.hidden=false;refresh.hidden=false;logout.hidden=false;exchange.hidden=true;active=true;
}
async function load(){
 const current=++generation;panel.hidden=true;
 try{const data=await call('location');if(current===generation)render(data);}
 catch(error){if(current!==generation)return;hide(problem(error));refresh.hidden=false;}
}
exchange.addEventListener('click',async()=>{
 if(busy)return;busy=true;exchange.disabled=true;status.textContent='조회 권한을 교환하고 있습니다.';
 try{const csrf=await bootstrap();await call('exchanges',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':exchangeKey},body:JSON.stringify({token:qrToken})});qrToken='';await load();}
 catch(error){hide(problem(error));}finally{busy=false;exchange.disabled=false;}
});
refresh.addEventListener('click',()=>{if(!busy)load();});
logout.addEventListener('click',async()=>{
 if(busy)return;busy=true;generation++;active=false;panel.hidden=true;
 try{const csrf=await bootstrap();await call('logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':crypto.randomUUID()},body:'{}'});hide('이 휴대폰의 조회 권한을 닫았습니다. 새 QR로 다시 연결할 수 있습니다.');}
 catch(error){hide(problem(error));refresh.hidden=false;}finally{busy=false;}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;panel.hidden=true;}else if(active&&!busy)load();});
setInterval(()=>{if(active&&!busy&&!document.hidden)load();},30000);
if(qrToken){if(/^[A-Za-z0-9_-]{43}$/.test(qrToken)){status.textContent='열기 버튼을 누르면 QR을 한 번 교환합니다. 다른 휴대폰에서는 다시 사용할 수 없습니다.';exchange.hidden=false;}else{qrToken='';hide('올바른 QR 링크가 아닙니다. 차량에서 새 QR을 발급하세요.');}}
else load();
