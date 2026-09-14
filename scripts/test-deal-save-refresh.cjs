const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const env=fs.readFileSync('.env','utf8'); const url=env.match(/VITE_SUPABASE_URL=["']?([^\s"']+)/)[1]; const ref=new URL(url).hostname.split('.')[0];
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try { for(const role of ['bpo_partner','admin_vmarket']){
 const page=await browser.newPage({viewport:{width:1440,height:1000}}); const requests=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const uid='983e7cdd-d130-473a-83ef-760b2e0dc55a';
 await page.addInitScript(({ref,uid})=>localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:uid,email:'test@example.com',aud:'authenticated',role:'authenticated'}})),{ref,uid});
 const org={id:'org-test',name:'Empresa original',type:'restaurante',state:'Rio de Janeiro',cnpjs:1,owner_id:uid};
 const person={id:'person-test',full_name:'Contato teste',email:'test@example.com',owner_id:uid};
 const stage={id:'stage-test',name:'Novo',sort_order:1,pipeline_name:'Pipeline de Vendas',pipedrive_stage_id:1};
 const deal={id:'deal-test',title:'Negocio teste',organization_id:org.id,person_id:person.id,owner_id:uid,stage_id:stage.id,status:'aberto',business_type:'restaurante',value:100,created_at:'2026-09-01T12:00:00Z'};
 const joined=()=>({...deal,organizations:{...org},people:{...person},pipeline_stages:stage});
 await page.route(url+'/**',async route=>{
 const req=route.request();const u=new URL(req.url());const table=u.pathname.split('/').pop();const method=req.method();requests.push({table,method,query:u.search,body:method==='GET'?null:req.postDataJSON()});
 if(method==='PATCH'){
  Object.assign(table==='deals'?deal:table==='organizations'?org:person,req.postDataJSON());
  return route.fulfill({status:204});
 }
 let data=[];
 if(table==='pipedrive-sync')data={ok:true,pipedrive_deal_id:123};
 else if(method==='POST')data=[];
 else if(table==='profiles')data={id:uid,role,full_name:'Teste'};
 else if(table==='pipeline_stages')data=[stage];
 else if(table==='organizations')data=[org];
 else if(table==='people')data=[person];
 else if(table==='deals')data=u.searchParams.has('id')?joined():[joined(),{...joined(),id:'deal-shared',title:'Negocio compartilhado'}];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto((process.env.TEST_APP_URL||'http://127.0.0.1:5174/')+'?deal=deal-test');
 const edit=page.getByRole('button',{name:'Editar Empresa',exact:true}); await edit.waitFor();
 requests.length=0;
 await edit.click();
 const input=page.locator('input').filter({visible:true});
 const active=page.locator('input:focus'); await active.fill('Empresa atualizada');
 const block=active.locator('..'); await block.getByRole('button',{name:'Salvar',exact:true}).click();
 await block.getByRole('button',{name:'Salvando...',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Editar Empresa',exact:true}).waitFor();
 assert.equal(org.name,'Empresa atualizada');
 assert(requests.some(r=>r.table==='pipedrive-sync'),'Pipedrive integration preserved');
 const reads=requests.filter(r=>r.method==='GET');
 assert(reads.length>0);
 assert(reads.every(r=>['deals','deal_history','custom_field_values'].includes(r.table)),JSON.stringify(reads));
 assert(reads.every(r=>r.query.includes(r.table==='deals'?'id=eq.deal-test':r.table==='deal_history'?'deal_id=eq.deal-test':'entity_id=eq.deal-test')),JSON.stringify(reads));
 await page.getByRole('button',{name:/Voltar/}).first().click();
 await page.getByRole('button',{name:'Lista',exact:true}).click();
 await page.getByRole('cell',{name:'Empresa atualizada',exact:true}).first().waitFor();
 assert.equal(await page.getByRole('cell',{name:'Empresa atualizada',exact:true}).count(),2,'shared company snapshots refreshed');
 assert.deepEqual(errors,[]);
 console.log('PASS',role,': save + Pipedrive + scoped read-back only; shared company updated; no global reload; no JS errors (mock API)');
 await page.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
