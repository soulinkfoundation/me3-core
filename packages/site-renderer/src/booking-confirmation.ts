export function bookingConfirmationMarkup(): string {
  return `<dialog class="booking-confirmation" data-booking-confirmation aria-label="Booking confirmed">
    <span class="booking-confirmation__icon" aria-hidden="true">✓</span>
    <h2>Your booking is confirmed</h2>
    <p class="booking-confirmation__details" data-booking-confirmation-details></p>
    <p data-booking-confirmation-message></p>
    <form method="dialog"><button type="submit" autofocus>Done</button></form>
  </dialog>`;
}

/** Runs inside each booking widget, sharing its root and persistent status. */
export function bookingConfirmationRuntime(): string {
  return `var confirmationDialog=root.querySelector('[data-booking-confirmation]');
  if(confirmationDialog)confirmationDialog.addEventListener('close',function(){statusEl.tabIndex=-1;statusEl.focus({preventScroll:true});statusEl.scrollIntoView({block:'nearest'});});
  function confirmationDetails(booking,title,timezone){
    var details=title||'';
    if(booking&&booking.startsAt){var date=new Date(booking.startsAt);if(!isNaN(date.getTime()))details+=String.fromCharCode(10)+date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:timezone||'UTC'})+' · '+(timezone||'UTC');}
    return details;
  }
  function showConfirmation(details,message){
    if(!confirmationDialog)return;
    confirmationDialog.querySelector('[data-booking-confirmation-details]').textContent=details||'';
    confirmationDialog.querySelector('[data-booking-confirmation-message]').textContent=message;
    if(!confirmationDialog.open&&typeof confirmationDialog.showModal==='function')confirmationDialog.showModal();
  }`;
}

export const bookingConfirmationCss = `
.booking-confirmation{box-sizing:border-box;width:calc(100% - 32px);max-width:440px;max-height:calc(100dvh - 32px);overflow:auto;padding:28px;border:1px solid var(--border);border-radius:var(--radius-md,12px);background:var(--surface);color:var(--text);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.booking-confirmation::backdrop{background:rgba(0,0,0,.55)}
.booking-confirmation__icon{display:grid;place-items:center;width:48px;height:48px;margin:0 auto 20px;border-radius:50%;background:var(--accent);color:var(--accent-text,#fff);font-size:28px}
.booking-confirmation h2{margin:0 0 16px;font-size:1.5rem;line-height:1.25}
.booking-confirmation p{margin:12px 0;color:var(--muted)}
.booking-confirmation .booking-confirmation__details{white-space:pre-line;color:var(--text);font-weight:700}
.booking-confirmation form{margin:24px 0 0}
.booking-confirmation button{width:100%;min-height:44px;padding:10px 20px;border:0;border-radius:var(--button-radius,var(--radius-sm,8px));background:var(--accent);color:var(--accent-text,#fff);font:inherit;font-weight:700;cursor:pointer}
.booking-confirmation button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
`;
