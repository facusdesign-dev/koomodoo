const sb=window.supabase.createClient('https://qbpvrfouhsycbzgzltih.supabase.co','sb_publishable_WuXm4DcjX4r4ZCLeAuBBbw__2OlJl4C');
const card=document.querySelector('#card'),status=document.querySelector('#status');
const messages={ready:'Pedido listo para probar.',approved:'Pago aprobado. Este pedido ya no se puede pagar.',processing:'Estamos verificando el pago. No vuelvas a pagar.',rejected:'Pago rechazado. Podés intentar nuevamente.',review:'Pedido en revisión. No vuelvas a pagar.',unassigned:'Tu cuenta no tiene asignado este ensayo.',configuration:'El ensayo todavía no está configurado.',invalid:'Revisá la tarjeta y el correo de prueba.',unknown:'No pudimos verificar el estado. No vuelvas a pagar.'};
let brick,previous=null,working=false,order=null;
async function call(body){
  const {data,error}=await sb.functions.invoke('mp-card-pilot',{body});
  if(!error)return data;
  return await error.context?.json?.().catch(()=>null)||{state:'unknown'};
}
async function refresh(){
  if(working)return;
  working=true;
  try{
    const data=await call({action:'status'});
    status.textContent=messages[data.state]||messages.unknown;
    const open=['ready','rejected'].includes(data.state);
    card.hidden=!open;
    if(!open){if(brick){await brick.unmount();brick=null;}return;}
    if(order && order!==data.order){location.reload();return;}
    order=data.order;previous=data.previous;
    if(!brick)brick=await new MercadoPago(data.publicKey,{locale:'es-UY'}).bricks().create('cardPayment','card',{
      initialization:{amount:100},customization:{paymentMethods:{maxInstallments:1}},
      callbacks:{onReady:()=>{},onError:()=>{status.textContent='No se pudo cargar el formulario de prueba.';},
        onSubmit:async form=>{
          if(working)return;
          working=true;card.hidden=true;status.textContent=messages.processing;
          try{const r=await call({action:'pay',order,token:form.token,method:form.payment_method_id,email:form.payer?.email,
            identification:form.payer?.identification,issuer:form.issuer_id,previous});
            status.textContent=messages[r.state]||messages.unknown;
          }finally{working=false;}
        }}
    });
  }catch{card.hidden=true;status.textContent=messages.unknown;}finally{working=false;}
}
if(!(await sb.auth.getSession()).data.session)status.textContent='Iniciá sesión en Koomodoo y después volvé a esta página.';
else{await refresh();setInterval(()=>{if(!document.hidden)refresh();},4000);}
