const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const env=fs.readFileSync('.env','utf8'); const url=env.match(/VITE_SUPABASE_URL=["']?([^\s"']+)/)[1];
 const ref=new URL(url).hostname.split('.')[0];
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
 for(const [role,fail] of [['bpo_partner',false],['admin_vmarket',false],['bpo_partner',true]]){
 const page=await browser.newPage(); const requests=[];
 await page.addInitScript(({ref})=>localStorage.setItem(`sb-${ref}-auth-token`,JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:'983e7cdd-d130-473a-83ef-760b2e0dc55a',email:'test@example.com',aud:'authenticated',role:'authenticated'}})),{ref});
 await page.route(url+'/**',async route=>{
 const u=new URL(route.request().url()); const table=u.pathname.split('/').pop(); requests.push(table);
 if(fail&&table==='people')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Erro de teste de contatos',code:'TEST'})});
 let data=[];
 if(table==='profiles')data={id:'983e7cdd-d130-473a-83ef-760b2e0dc55a',role,full_name:'Teste'};
 if(table==='pipeline_stages')data=[{id:'stage-test',name:'Novo',sort_order:1,pipeline_name:'Pipeline de Vendas'}];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:5173');
 await page.getByRole('button',{name:'Avisos',exact:true}).waitFor({state:role==='admin_vmarket'?'visible':'hidden'});
 await page.getByText('Você não tem negócios no momento.',{exact:true}).waitFor();
 const body=await page.locator('body').innerText();
 if(body.includes('[object Object]'))throw Error('Opaque error');
 if(fail&&!body.includes('Falha ao carregar contatos: Erro de teste de contatos'))throw Error('Missing descriptive error');
 if(!fail&&body.includes('Erro:'))throw Error('Unexpected empty-account error');
 if(role!=='admin_vmarket'&&requests.some(t=>['audit_logs','automation_rules','automation_rule_executions','automation_rule_changes'].includes(t)))throw Error('Admin query issued for BPO');
 if(!fail){
 await page.getByRole('button',{name:'Contatos',exact:true}).click();
 await page.getByText('Você não tem contatos no momento.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Empresas',exact:true}).click();
 await page.getByText('Você não tem empresa no momento.',{exact:true}).waitFor();
 }
 console.log('PASS',role,fail?'partial failure preserves app and readable error':'empty messages in all 3 modules; warning permission correct');
 await page.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
