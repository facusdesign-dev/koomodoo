window.CartDock = (() => {
  function summary(items){
    const totals=new Map();let quantity=0;
    for(const item of items){quantity+=Number(item.qty)||0;totals.set(item.currency||'UYU',(totals.get(item.currency||'UYU')||0)+Number(item.price)*Number(item.qty));}
    return {quantity,totals:[...totals].map(([currency,total])=>({currency,total}))};
  }
  function render(){
    let dock=document.getElementById('cart-dock');
    if(!dock){dock=document.createElement('button');dock.id='cart-dock';dock.type='button';dock.onclick=()=>nav('carrito');document.body.append(dock);}
    const data=summary(typeof cart==='undefined'?[]:cart);
    const presenter=currentPage==='live'&&document.querySelector('#live-player-layout[data-presenter="true"]:not([hidden])');
    const visible=data.quantity>0&&typeof KMD!=='undefined'&&KMD.loggedIn&&!presenter&&!['carrito','pedidos'].includes(currentPage);
    dock.hidden=!visible;document.body.classList.toggle('has-cart-dock',visible);
    if(!visible)return;
    dock.replaceChildren();const title=document.createElement('strong');title.textContent=`Ver carrito (${data.quantity})`;
    const amount=document.createElement('span');amount.textContent=data.totals.map(row=>CommerceUI.money(row.total,row.currency)).join(' + ');dock.append(title,amount);
    dock.setAttribute('aria-label',title.textContent+' '+amount.textContent);
  }
  document.addEventListener('DOMContentLoaded',render);
  return {render,summary};
})();
