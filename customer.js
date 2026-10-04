(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  let currentUser = null;
  let catalog = [];
  let extensionRental = null;
  let extensionDays = 1;
  let toastTimer = null;

  function money(v){
    return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0));
  }
  function esc(v){
    return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }
  function formatDate(v){
    if(!v) return "-";
    return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${v}T00:00:00`));
  }
  function dateToday(){
    const d=new Date();
    return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  }
  function dateDiff(start,end){
    if(!start||!end) return 0;
    const s=Date.parse(`${start}T00:00:00`),e=Date.parse(`${end}T00:00:00`);
    return !Number.isFinite(s)||!Number.isFinite(e)||e< s?0:Math.floor((e-s)/86400000)+1;
  }
  function addDays(dateValue,days){
    const d=new Date(`${dateValue}T00:00:00`);
    d.setDate(d.getDate()+Number(days||0));
    return d.toISOString().slice(0,10);
  }
  function toast(msg){
    const el=$("toast");
    el.textContent=msg;el.classList.add("show");
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2800);
  }
  async function api(url,options={}){
    const res=await fetch(url,{
      credentials:"same-origin",
      headers:{...(options.body!==undefined?{"Content-Type":"application/json"}:{}),...(options.headers||{})},
      ...options
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      const err=new Error(data.message||"Terjadi kesalahan.");
      err.code=data.error;err.status=res.status;throw err;
    }
    return data;
  }
  function openModal(id){$(id).hidden=false;document.body.style.overflow="hidden"}
  function closeModal(id){$(id).hidden=true;document.body.style.overflow=""}

  function approvalStatusFor(status){
    if(status==="pending") return {label:"Menunggu persetujuan",cls:"pending"};
    if(status==="approved") return {label:"Disetujui",cls:"approved"};
    return {label:"Ditolak",cls:"rejected"};
  }

  function statusFor(rental){
    if(rental.approvalStatus==="pending") return {label:"Menunggu persetujuan",cls:"warn"};
    if(rental.approvalStatus==="rejected") return {label:"Ditolak",cls:"done"};
    if(rental.status==="Dikembalikan") return {label:"Dikembalikan",cls:"done"};
    const today=dateToday();
    return rental.returnDate<today?{label:"Terlambat",cls:"warn"}:{label:rental.status,cls:""};
  }

  function renderAccountStatus(){
    const info=approvalStatusFor(currentUser.approvalStatus || "approved");
    const badge=$("accountApprovalBadge");
    badge.textContent=info.label;
    badge.className=`approval-badge ${info.cls}`;
    $("statusCustomerName").textContent=currentUser.name || "-";
    $("statusCustomerContact").textContent=`${currentUser.email || "-"} · ${currentUser.phone || "-"}`;

    const reasonBox=$("accountRejectionBox");
    const reason=String(currentUser.rejectionReason || "").trim();
    reasonBox.hidden=info.cls!=="rejected";
    $("accountRejectionReason").textContent=reason || "Admin tidak memberikan alasan.";
  }

  function renderStatusOnly(){
    renderAccountStatus();
    const rentals=currentUser?.rentals||[];
    $("statusOrders").innerHTML=rentals.length
      ? rentals.map(r=>{
          const approval=approvalStatusFor(r.approvalStatus || "approved");
          const reason=(r.rejectionReason||"").trim();
          const items=r.items.map(i=>`<span class="status-order-item">${esc(i.equipment)} × ${i.quantity}</span>`).join("");
          return `<article class="status-order">
            <div class="status-order-head">
              <div class="status-order-title">Pesanan #${r.id}</div>
              <span class="approval-badge ${approval.cls}">${approval.label}</span>
            </div>
            <div class="status-order-items">${items}</div>
            <div class="status-order-meta">${formatDate(r.startDate)} — ${formatDate(r.returnDate)} · ${money(r.totalPrice)}</div>
            ${approval.cls==="rejected" ? `<div class="status-reason"><span>Alasan penolakan admin</span><strong>${esc(reason || "Admin tidak memberikan alasan.")}</strong></div>` : ""}
          </article>`;
        }).join("")
      : `<div class="empty">Belum ada permintaan sewa.</div>`;
  }

  function renderStats(){
    const rentals=currentUser?.rentals||[];
    const active=rentals.filter(r=>r.approvalStatus==="approved"&&r.status!=="Dikembalikan");
    const unitCount=active.reduce((sum,r)=>sum+r.items.reduce((s,i)=>s+Number(i.quantity||0),0),0);
    const total=rentals.reduce((sum,r)=>sum+Number(r.totalPrice||0),0);
    $("activeCount").textContent=active.length;
    $("unitCount").textContent=unitCount;
    $("historyCount").textContent=rentals.length;
    $("totalSpend").textContent=money(total);
  }

  function rentalCard(rental){
    const st=statusFor(rental);
    const items=rental.items.map(item=>`
      <div class="rental-item">
        <strong>${esc(item.equipment)}</strong>
        <span>${item.quantity} unit</span>
      </div>`).join("");
    const ext=rental.extensionRequest;
    const canExtend=rental.approvalStatus==="approved"&&rental.status!=="Dikembalikan";
    const reason=(rental.rejectionReason||"").trim();
    const approval=approvalStatusFor(rental.approvalStatus || "approved");
    let extensionBlock="";
    if(ext?.status==="pending") {
      extensionBlock=`<div class="extension-pending"><div><span>Perpanjangan</span><strong>Menunggu persetujuan admin</strong></div><small>+${ext.additionalDays} hari · kembali ${formatDate(ext.requestedReturnDate)} · tambahan ${money(ext.extraTotal)}. Total berubah setelah admin menyetujui.</small></div>`;
    } else if(ext?.status==="rejected") {
      extensionBlock=`<div class="extension-rejected"><div><span>Perpanjangan terakhir ditolak</span><strong>+${ext.additionalDays} hari</strong></div><small>Alasan: ${esc(ext.rejectionReason||"Admin tidak memberikan alasan.")}</small></div>`;
    }
    const extensionAction=canExtend
      ? (ext?.status==="pending"
        ? `<button class="extend-btn pending" type="button" disabled>Menunggu persetujuan</button>`
        : `<button class="extend-btn" data-extend="${rental.id}">Ajukan perpanjangan</button>`)
      : `<span class="status done">Selesai</span>`;
    return `<article class="rental-card">
      <div class="rental-top">
        <div class="order-id">Pesanan #${rental.id}</div>
        <span class="status ${st.cls}">${esc(st.label)}</span>
      </div>
      <div class="approval-line">
        <span>Status persetujuan</span>
        <span class="approval-badge ${approval.cls}">${approval.label}</span>
      </div>
      ${approval.cls==="rejected" ? `<div class="status-reason"><span>Alasan penolakan admin</span><strong>${esc(reason || "Admin tidak memberikan alasan.")}</strong></div>` : ""}
      <div class="rental-items">${items}</div>
      <div class="rental-meta">
        <div class="meta-box"><span>Mulai</span><strong>${formatDate(rental.startDate)}</strong></div>
        <div class="meta-box"><span>Kembali</span><strong>${formatDate(rental.returnDate)}</strong></div>
      </div>
      ${extensionBlock}
      <div class="rental-footer">
        <div class="rental-total"><span>Total transaksi</span><strong>${money(rental.totalPrice)}</strong></div>
        ${extensionAction}
      </div>
    </article>`;
  }

  function renderRentals(){
    const rentals=currentUser?.rentals||[];
    const active=rentals.filter(r=>r.approvalStatus==="approved"&&r.status!=="Dikembalikan");
    const pending=rentals.filter(r=>r.approvalStatus==="pending"||r.approvalStatus==="rejected");
    const history=rentals.filter(r=>r.approvalStatus==="approved"&&r.status==="Dikembalikan");

    $("pendingSection").hidden=!pending.length;
    $("pendingRentals").innerHTML=pending.length
      ? pending.map(rentalCard).join("")
      : "";

    $("activeRentals").innerHTML=active.length
      ? active.map(rentalCard).join("")
      : `<div class="empty">Belum ada sewaan aktif. Tekan <strong>Tambah alat sewa</strong> untuk membuat pesanan baru.</div>`;

    $("historyRentals").innerHTML=history.length
      ? history.map(r=>`<article class="history-row">
          <div><strong>#${r.id}</strong><span>${formatDate(r.createdAt)}</span></div>
          <div><strong>${r.items.map(i=>`${esc(i.equipment)} × ${i.quantity}`).join(", ")}</strong><span>${r.days} hari</span></div>
          <div><span>Periode</span><strong>${formatDate(r.startDate)} — ${formatDate(r.returnDate)}</strong></div>
          <div><span>Total</span><strong>${money(r.totalPrice)}</strong></div>
        </article>`).join("")
      : `<div class="empty">Belum ada riwayat pengembalian.</div>`;
  }

  function renderProfile(){
    $("customerName").textContent=currentUser.name;
    $("userMini").textContent=currentUser.email;
    $("profileEmail").textContent=currentUser.email;
    $("profilePhone").textContent=currentUser.phone;

    const info=approvalStatusFor(currentUser.approvalStatus || "approved");
    const chip=$("profileApprovalChip");
    chip.textContent=`Akun ${info.label.toLowerCase()}`;
    chip.style.background=info.cls==="approved"?"#e7f2e7":info.cls==="rejected"?"#f5e5e3":"#fbf0df";
    chip.style.color=info.cls==="approved"?"#2f6b4c":info.cls==="rejected"?"#a64339":"#a86b1a";

    const reason=(currentUser.rejectionReason||"").trim();
    $("profileApprovalReason").hidden=info.cls!=="rejected";
    $("profileApprovalReason").textContent=reason ? `Alasan: ${reason}` : "Akun ditolak admin.";
  }

  function selectedItems(){
    return [...$("rentalItems").querySelectorAll(".item-row")].flatMap(row=>{
      const check=row.querySelector(".item-check");
      if(!check?.checked||check.disabled)return [];
      const qty=Number(row.querySelector(".qty-value")?.textContent||0);
      return qty>0?[{catalogId:Number(check.value),quantity:qty}]:[];
    });
  }

  function setQty(id,qty){
    const row=$("rentalItems").querySelector(`.item-row[data-id="${CSS.escape(String(id))}"]`);
    if(!row)return;
    const item=catalog.find(x=>Number(x.id)===Number(id));
    const check=row.querySelector(".item-check");
    const value=row.querySelector(".qty-value");
    const minus=row.querySelector('[data-qty="minus"]');
    const plus=row.querySelector('[data-qty="plus"]');
    const stock=Number(item?.stock||0);
    let next=Math.max(1,Math.min(stock,Math.floor(Number(qty)||1)));
    if(!check.checked||stock<=0)next=0;
    value.textContent=String(next);
    minus.disabled=!check.checked||next<=1;
    plus.disabled=!check.checked||next>=stock;
  }

  function renderPicker(selectedProduct=null){
    $("rentalItems").innerHTML=catalog.map(item=>{
      const stock=Number(item.stock||0);
      const selected=Number(item.id)===Number(selectedProduct);
      const icon=item.photo?`<img src="${item.photo}" alt="">`:esc(item.icon||"🎒");
      return `<div class="item-row ${stock<=0?"disabled":""}" data-id="${item.id}">
        <span class="item-icon">${icon}</span>
        <span class="item-copy">
          <strong>${esc(item.name)}</strong>
          <small>${money(item.price)}/hari</small>
          <span class="stock-note">Stok tersedia: ${stock} unit</span>
        </span>
        <span class="qty-wrap">
          <button type="button" class="qty-btn" data-qty="minus" ${!selected||stock<=0?"disabled":""}>−</button>
          <span class="qty-value">${selected?1:0}</span>
          <button type="button" class="qty-btn" data-qty="plus" ${!selected||stock<=1?"disabled":""}>+</button>
        </span>
        <input class="item-check" type="checkbox" value="${item.id}" ${selected?"checked":""} ${stock<=0?"disabled":""}>
      </div>`;
    }).join("");

    $("rentalItems").querySelectorAll(".item-check").forEach(check=>{
      check.addEventListener("change",()=>{
        setQty(Number(check.value),check.checked?1:0);
        updateTotals();
      });
    });
    $("rentalItems").querySelectorAll(".qty-btn").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const row=btn.closest(".item-row");
        const id=Number(row.dataset.id);
        const check=row.querySelector(".item-check");
        if(!check.checked){check.checked=true}
        const current=Number(row.querySelector(".qty-value").textContent||1);
        setQty(id,current+(btn.dataset.qty==="plus"?1:-1));
        updateTotals();
      });
    });
  }

  function updateTotals(){
    const items=selectedItems();
    const days=dateDiff($("rentalStartDate").value,$("rentalReturnDate").value);
    const priceMap=Object.fromEntries(catalog.map(item=>[item.id,Number(item.price)]));
    const units=items.reduce((s,i)=>s+i.quantity,0);
    const total=items.reduce((s,i)=>s+(priceMap[i.catalogId]||0)*i.quantity*days,0);
    $("rentalTotal").textContent=money(total);
    $("rentalSummary").textContent=`${items.length} jenis • ${units} unit${days?` • ${days} hari`:""}`;
    $("rentalDateSummary").textContent=days?`${days} hari`:"Pilih tanggal";
  }

  function openAddRental(productId=null){
    $("rentalMessage").textContent="";
    renderPicker(productId);
    const today=dateToday();
    $("rentalStartDate").min=today;
    $("rentalStartDate").value=today;
    $("rentalReturnDate").value=addDays(today,1);
    $("rentalReturnDate").min=today;
    updateTotals();
    openModal("rentalModal");
  }

  async function onRentalSubmit(e){
    e.preventDefault();$("rentalMessage").textContent="";
    const items=selectedItems();
    const startDate=$("rentalStartDate").value;
    const returnDate=$("rentalReturnDate").value;
    if(!items.length){$("rentalMessage").textContent="Pilih minimal satu alat.";return}
    if(!dateDiff(startDate,returnDate)){$("rentalMessage").textContent="Tanggal sewa tidak valid.";return}
    try{
      const data=await api("/api/rentals",{method:"POST",body:JSON.stringify({startDate,returnDate,items})});
      closeModal("rentalModal");
      toast(`Pesanan #${data.rental.rentalId} berhasil dibuat.`);
      await refresh();
    }catch(err){$("rentalMessage").textContent=err.message}
  }

  function openExtension(id){
    extensionRental=(currentUser?.rentals||[]).find(r=>Number(r.id)===Number(id));
    if(!extensionRental)return;
    extensionDays=1;
    $("extendTitle").textContent=`Perpanjang pesanan #${extensionRental.id}`;
    const ext=extensionRental.extensionRequest;
    $("extendCurrent").textContent=`Tanggal kembali saat ini: ${formatDate(extensionRental.returnDate)}. Pengajuan baru akan diproses setelah disetujui admin.`;
    $("extendMessage").textContent="";
    document.querySelectorAll(".extend-option").forEach(btn=>btn.classList.toggle("active",Number(btn.dataset.days)===extensionDays));
    updateExtensionPreview();
    openModal("extendModal");
  }

  function updateExtensionPreview(){
    if(!extensionRental)return;
    const extraCost=extensionRental.items.reduce((sum,item)=>sum+Number(item.unitPrice||0)*Number(item.quantity||0)*extensionDays,0);
    $("extensionDays").textContent=`+${extensionDays} hari`;
    $("extensionReturn").textContent=formatDate(addDays(extensionRental.returnDate,extensionDays));
    $("extensionCost").textContent=money(extraCost);
  }

  async function confirmExtension(){
    if(!extensionRental)return;
    $("extendMessage").textContent="";
    try{
      const data=await api(`/api/rentals/${extensionRental.id}/extend`,{method:"POST",body:JSON.stringify({additionalDays:extensionDays})});
      closeModal("extendModal");
      toast(`Pengajuan perpanjangan #${extensionRental.id} dikirim. Menunggu persetujuan admin.`);
      await refresh();
    }catch(err){$("extendMessage").textContent=err.message}
  }

  async function refresh(){
    const [me,cat]=await Promise.all([api("/api/me"),api("/api/catalog")]);
    if(!me.authenticated || !["customer","customer_status"].includes(me.kind)){
      location.replace("index.html");
      return;
    }

    currentUser={...me,rentals:me.rentals||[]};
    catalog=cat.catalog||[];

    if(me.kind==="customer_status"){
      $("statusView").hidden=false;
      $("dashboardView").hidden=true;
      renderStatusOnly();
      return;
    }

    $("statusView").hidden=true;
    $("dashboardView").hidden=false;
    renderProfile();
    renderStats();
    renderRentals();
  }

  async function logout(){
    await api("/api/auth/logout",{method:"POST"});
    location.replace("index.html");
  }

  document.addEventListener("click",event=>{
    const close=event.target.closest("[data-close]");
    if(close){closeModal(close.dataset.close);return}
    const extend=event.target.closest("[data-extend]");
    if(extend){openExtension(Number(extend.dataset.extend));return}
    const option=event.target.closest(".extend-option");
    if(option){
      extensionDays=Number(option.dataset.days);
      document.querySelectorAll(".extend-option").forEach(btn=>btn.classList.toggle("active",Number(btn.dataset.days)===extensionDays));
      updateExtensionPreview();return;
    }
    if(event.target.id==="addRentalBtn"||event.target.id==="addRentalBottom"){openAddRental();return}
    if(event.target.id==="confirmExtend"){confirmExtension();return}
    if(event.target.classList.contains("modal")&&event.target===event.target.closest(".modal"))closeModal(event.target.id);
  });

  $("rentalForm").addEventListener("submit",onRentalSubmit);
  $("logoutBtn").addEventListener("click",logout);
  $("statusLogoutBtn").addEventListener("click",logout);
  $("rentalStartDate").addEventListener("change",()=>{updateTotals();$("rentalReturnDate").min=$("rentalStartDate").value||dateToday();});
  $("rentalReturnDate").addEventListener("change",updateTotals);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){document.querySelectorAll(".modal:not([hidden])").forEach(m=>closeModal(m.id));}});

  (async function init(){
    try{
      await refresh();
      const params=new URLSearchParams(location.search);
      const product=params.get("product");
      if(product){
        const id=Number(product);
        if(catalog.some(item=>Number(item.id)===id))openAddRental(id);
        history.replaceState({},document.title,"customer.html");
      }
    }catch{
      location.replace("index.html");
    }
  })();
})();
