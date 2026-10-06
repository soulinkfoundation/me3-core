/** Runs after the individual widgets have attached their selection handlers. */
export function bookingNavigationScript(): string {
  return `(function(){
  var root=document.currentScript.closest('.booking');
  if(!root)return;
  function applyLink(){
    var params=new URLSearchParams(window.location.search);
    var offerId=params.get('offer');
    var type=params.get('bookingType');
    var panels=Array.prototype.slice.call(root.querySelectorAll('[data-booking-type-panel]'));
    var panel=panels.find(function(item){
      if(type&&item.dataset.bookingTypePanel!==type)return false;
      return offerId?Array.prototype.some.call(item.querySelectorAll('[data-offer-id],option'),function(choice){return (choice.dataset.offerId||choice.value)===offerId;}):!!type;
    });
    panels.forEach(function(item){item.toggleAttribute('data-booking-shared-offer',item===panel&&!!offerId);});
    var wrapper=root.closest('.site-offer-booking');
    if(wrapper&&(window.location.hash==='#booking'||panel))wrapper.hidden=false;
    if(panel){
      var tab=Array.prototype.find.call(root.querySelectorAll('[data-booking-type-tab]'),function(item){return item.dataset.bookingTypeTab===panel.dataset.bookingTypePanel;});
      if(tab)tab.click();
      var card=Array.prototype.find.call(panel.querySelectorAll('[data-offer-id]'),function(item){return item.dataset.offerId===offerId;});
      var select=panel.querySelector('[data-booking-offer-select]');
      if(card){card.click();card.scrollIntoView({block:'nearest',inline:'center'});}
      else if(select&&offerId){select.value=offerId;select.dispatchEvent(new Event('change',{bubbles:true}));}
    }
    if(window.location.hash==='#booking'||panel){
      var scrollToBooking=function(){root.scrollIntoView({block:'start'});};
      if(document.readyState==='complete')scrollToBooking();
      else window.addEventListener('load',scrollToBooking,{once:true});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLink);else applyLink();
  window.addEventListener('popstate',applyLink);
  window.addEventListener('hashchange',applyLink);
})();`;
}
