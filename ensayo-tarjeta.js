const sb=window.supabase.createClient('https://qbpvrfouhsycbzgzltih.supabase.co','sb_publishable_WuXm4DcjX4r4ZCLeAuBBbw__2OlJl4C');
const card=document.querySelector('#card'),status=document.querySelector('#status');
const cartOrder=new URLSearchParams(location.search).get('pedido');
const messages={ready:'Pedido listo para probar.',approved:'Pago aprobado. Este pedido ya no se puede pagar.',processing:'Estamos verificando el pago. No vuelvas a pagar.',rejected:'Pago rechazado. Podés intentar nuevamente.',review:'Pedido en revisión. No vuelvas a pagar.',unassigned:'Tu cuenta no tiene asignado este ensayo.',configuration:'El ensayo todavía no está configurado.',invalid:'Revisá la tarjeta y el correo de prueba.',unknown:'No pudimos verificar el estado. No vuelvas a pagar.'};
let brick,previous=null,working=false,order=null;
const actions=document.querySelector('#rejection-actions');
messages.closed_pending='La reserva terminó y el pago sigue sin confirmar. No vuelvas a pagar. No hay entrega autorizada.';
messages.rejected='Pago rechazado. Podés reintentar mientras la reserva siga vigente o cancelar el pedido.';
let retryAttempt=null;
document.querySelector('#retry').onclick=async()=>{if(!working){retryAttempt=previous;await refresh();}};
document.querySelector('#cancel').onclick=async()=>{
  if(working||!cartOrder||!previous||!confirm('¿Cancelar este pedido y liberar la unidad reservada?'))return;
  working=true;actions.hidden=true;card.hidden=true;
  try{const {error}=await sb.rpc('cancel_order',{p_order:cartOrder});if(error)throw error;}
  catch{status.textContent='No se pudo confirmar la cancelación. Consultá el estado antes de volver a intentar.';}
  finally{working=false;await refresh();}
};
async function call(body){
  const {data,error}=await sb.functions.invoke('mp-card-pilot',{body:{...body,cartOrder}});
  if(!error)return data;
  return await error.context?.json?.().catch(()=>null)||{state:'unknown'};
}
async function refresh(){
  if(working)return;
  working=true;
  try{
    const data=await call({action:'status'});
    status.textContent=data.state==='closed'?'La reserva terminó. No se puede pagar.':messages[data.state]||messages.unknown;
    if(Number.isFinite(data.amount))document.querySelector('#order-total').textContent=new Intl.NumberFormat('es-UY',{style:'currency',currency:'UYU'}).format(data.amount)+' · Sin entrega';
    actions.hidden=!(cartOrder && data.state==='rejected' && data.previous);
    const open=data.state==='ready'||(data.state==='rejected' && (!cartOrder||retryAttempt===data.previous));
    previous=data.previous;
    card.hidden=!open;
    if(!open){if(brick){await brick.unmount();brick=null;}return;}
    if(order && order!==data.order){location.reload();return;}
    order=data.order;previous=data.previous;
    if(!brick)brick=await new MercadoPago(data.publicKey,{locale:'es-UY'}).bricks().create('cardPayment','card',{
      initialization:{amount:data.amount},customization:{paymentMethods:{maxInstallments:1}},
      callbacks:{onReady:()=>{},onError:()=>{status.textContent='No se pudo cargar el formulario de prueba.';},
        onSubmit:async form=>{
          if(working)return;
          working=true;retryAttempt=null;actions.hidden=true;card.hidden=true;status.textContent=messages.processing;
          try{const r=await call({action:'pay',order,token:form.token,method:form.payment_method_id,email:form.payer?.email,
            identification:form.payer?.identification,issuer:form.issuer_id,previous});
            status.textContent=messages[r.state]||messages.unknown;
          }finally{working=false;}
        }}
    });
  }catch{actions.hidden=true;card.hidden=true;status.textContent=messages.unknown;}finally{working=false;}
}
if(!(await sb.auth.getSession()).data.session)status.textContent='Iniciá sesión en Koomodoo y después volvé a esta página.';
else{await refresh();setInterval(()=>{if(!document.hidden)refresh();},4000);}
