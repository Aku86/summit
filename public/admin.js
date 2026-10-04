(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  let dashboard = {stats:{},rentals:[],catalog:[],users:[]};
  let currentAdmin=null;
  let admins = [];
  let photoData = "";

  function money(v){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0))}
  function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
  function formatDate(v){if(!v)return"-";return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${v}T00:00:00`))}
  let toastTimer;
  function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2800)}
  async function api(url,options={}){const res=await fetch(url,{credentials:"same-origin",headers:{...(options.body!==undefined?{"Content-Type":"application/json"}:{}),...(options.headers||{})},...options});const data=await res.json().catch(()=>({}));if(!res.ok){const e=new Error(data.message||"Terjadi kesalahan.");e.code=data.error;e.status=res.status;throw e}return data}


  function hideAllModals(){
    document.querySelectorAll(".modal").forEach(modal => {
      modal.hidden = true;
    });
    document.body.style.overflow = "";
  }

  function showLoginView(message=""){
    hideAllModals();
    $("loginView").hidden=false;
    $("dashboardView").hidden=true;
    $("loginMessage").textContent=message;
  }

  function openModal(id){$(id).hidden=false;document.body.style.overflow="hidden"}
  function closeModal(id){$(id).hidden=true;document.body.style.overflow=""}

  function effectiveStatus(r){
    if(r.approvalStatus==="pending") return {label:"Menunggu Persetujuan",cls:"warn"};
    if(r.approvalStatus==="rejected") return {label:"Ditolak",cls:"off"};
    if(r.status==="Dikembalikan") return {label:"Dikembalikan",cls:"off"};
    const today=new Date().toISOString().slice(0,10);
    if(r.returnDate<today) return {label:"Terlambat",cls:"warn"};
    return {label:r.status,cls:""};
  }

  function renderStats(){
    const s=dashboard.stats||{};
    $("statAccounts").textContent=s.totalAccounts||0;
    $("statActive").textContent=s.activeRentals||0;
    $("statToday").textContent=s.dueToday||0;
    $("statOverdue").textContent=s.overdueRentals||0;
    $("statNew").textContent=s.newOrders||0;
  }

  function renderRentals(filter="") {
    const q=filter.trim().toLowerCase();
    const rows=(dashboard.rentals||[]).filter(r=>{
      const ext=r.extensionRequest||{};
      const hay=[r.id,r.userName,r.userEmail,r.userPhone,ext.additionalDays,ext.requestedReturnDate,...r.items.map(i=>i.equipment)].join(" ").toLowerCase();
      return !q||hay.includes(q);
    });

    $("rentalBody").innerHTML=rows.length?rows.map(r=>{
      const st=effectiveStatus(r);
      const items=r.items.map(i=>`${esc(i.equipment)} × ${i.quantity}`).join("<br>");
      const ext=r.extensionRequest||null;
      const approval = r.approvalStatus==="pending"
        ? `<span class="status-pill warn">Menunggu persetujuan</span>`
        : r.approvalStatus==="rejected"
          ? `<span class="status-pill off">Ditolak</span>`
          : `<span class="status-pill">Disetujui</span>`;

      let extensionInfo="";
      if(ext?.status==="pending") {
        extensionInfo=`<div class="approval-reason extension-admin-pending"><strong>Perpanjangan menunggu persetujuan</strong><br>+${ext.additionalDays} hari → ${formatDate(ext.requestedReturnDate)} · ${money(ext.extraTotal)}</div>`;
      } else if(ext?.status==="rejected") {
        extensionInfo=`<div class="approval-reason">Perpanjangan terakhir ditolak${ext.rejectionReason?`: ${esc(ext.rejectionReason)}`:""}</div>`;
      }

      let actions="";
      if(r.approvalStatus==="pending") {
        actions=`<button class="small-btn green" data-approve-rental="${r.id}">Setujui</button>
                 <button class="small-btn danger" data-reject-rental="${r.id}">Tolak</button>`;
      } else if(r.approvalStatus==="approved") {
        if(ext?.status==="pending") {
          actions=`<button class="small-btn green" data-approve-extension="${ext.id}">Setujui perpanjangan</button>
                   <button class="small-btn danger" data-reject-extension="${ext.id}">Tolak</button>`;
        } else {
          actions = r.status!=="Dikembalikan"
            ? `<button class="small-btn green" data-return="${r.id}">Kembalikan</button>`
            : `<button class="small-btn" data-reactivate="${r.id}">Aktifkan</button>`;
        }
      }
      actions += `<button class="small-btn" data-print="${r.id}">Cetak</button>`;

      return `<tr>
        <td>#${r.id}</td>
        <td><strong>${esc(r.userName)}</strong><br><span>${esc(r.userEmail)}</span><br><span>${esc(r.userPhone)}</span></td>
        <td>${items}</td>
        <td>${formatDate(r.startDate)}<br>→ ${formatDate(r.returnDate)}</td>
        <td>${money(r.totalPrice)}</td>
        <td>${approval}${r.rejectionReason?`<div class="approval-reason">Alasan: ${esc(r.rejectionReason)}</div>`:""}${ext?.status?extensionInfo:""}<br><span class="status-pill ${st.cls}">${esc(st.label)}</span></td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join(""):`<tr><td colspan="7">Tidak ada transaksi.</td></tr>`;
  }

  function renderCatalog(){
    $("catalogBody").innerHTML=(dashboard.catalog||[]).map(item=>{
      const visual=item.photo?`<img class="tool-photo" src="${item.photo}" alt="">`:`<span class="tool-icon">${esc(item.icon||"🎒")}</span>`;
      return `<tr>
        <td><div class="tool-cell">${visual}<div><strong>${esc(item.name)}</strong><br><span>${esc(item.category)}</span></div></div></td>
        <td>${money(item.price)}</td><td>${item.stock}</td>
        <td><span class="status-pill ${item.active?"":"off"}">${item.active?"Aktif":"Nonaktif"}</span></td>
        <td><div class="table-actions">
          <button class="small-btn" data-edit-tool="${item.id}">Edit</button>
          <button class="small-btn" data-toggle-tool="${item.id}">${item.active?"Nonaktifkan":"Aktifkan"}</button>
          <button class="small-btn danger" data-delete-tool="${item.id}">Hapus</button>
        </div></td>
      </tr>`;
    }).join("");
  }

  function renderUsers(){
    $("usersBody").innerHTML=(dashboard.users||[]).map(u=>{
      const approval = u.approvalStatus==="pending"
        ? `<span class="status-pill warn">Menunggu</span>`
        : u.approvalStatus==="rejected"
          ? `<span class="status-pill off">Ditolak</span>`
          : `<span class="status-pill">Disetujui</span>`;
      const actions = u.approvalStatus==="pending"
        ? `<button class="small-btn green" data-approve-user="${u.id}">Setujui</button>
           <button class="small-btn danger" data-reject-user="${u.id}">Tolak</button>`
        : `<button class="small-btn" data-user-toggle="${u.id}" data-active="${u.active?0:1}">
             ${u.active?"Nonaktifkan":"Aktifkan"}
           </button>`;
      return `<tr>
        <td><strong>${esc(u.name)}</strong></td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.phone)}</td>
        <td>${approval}${u.rejectionReason?`<div class="approval-reason">Alasan: ${esc(u.rejectionReason)}</div>`:""}</td>
        <td><span class="status-pill ${u.active?"":"off"}">${u.active?"Aktif":"Nonaktif"}</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join("");
  }

  function renderAdmins(){
    $("adminsBody").innerHTML=admins.map(a=>`<tr>
      <td><strong>${esc(a.name)}</strong>${a.isDefault?`<br><span class="status-pill">Default</span>`:""}</td>
      <td>${esc(a.email)}</td><td>${esc(a.role)}</td>
      <td><span class="status-pill ${a.active?"":"off"}">${a.active?"Aktif":"Nonaktif"}</span></td>
      <td>${a.isDefault?`<span>Terproteksi</span>`:`<button class="small-btn" data-admin-toggle="${a.id}" data-active="${a.active?0:1}">${a.active?"Nonaktifkan":"Aktifkan"}</button>`}</td>
    </tr>`).join("");
  }

  function applyAdminPermissions(){
    const canManageAdmins=Boolean(currentAdmin?.isDefault);
    const tab=$("adminsTab");
    const add=$("addAdminBtn");
    const securityTab=$("securityTab");
    if(tab) tab.hidden=!canManageAdmins;
    if(add) add.hidden=!canManageAdmins;
    if(securityTab) securityTab.hidden=!canManageAdmins;
    const activeTab=document.querySelector('.tab.active')?.dataset.tab;
    if(!canManageAdmins && (activeTab==="admins" || activeTab==="security")){
      switchTab("rentals");
    }
  }

  async function loadAll(){
    const data=await api("/api/admin/dashboard");
    dashboard=data;
    renderStats();renderRentals($("rentalSearch").value);renderCatalog();renderUsers();
    if(currentAdmin?.isDefault){try{admins=(await api("/api/admin/admins")).admins||[];renderAdmins()}catch{}}
  }

  async function refreshDashboard(){
    const btn=$("refreshBtn");
    if(!btn || btn.disabled) return;
    const original=btn.textContent;
    btn.disabled=true;
    btn.classList.add("loading");
    btn.textContent="Memuat";
    try{
      await loadAll();
      toast("Data diperbarui.");
    }catch(err){
      if(err.status===401){
        currentAdmin=null;
        showLoginView("Sesi admin berakhir. Silakan masuk kembali.");
      }else{
        toast(err.message||"Gagal memperbarui data.");
      }
    }finally{
      btn.disabled=false;
      btn.classList.remove("loading");
      btn.textContent=original;
    }
  }

  function switchTab(name){
    document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
    document.querySelectorAll(".tab-panel").forEach(p=>p.hidden=p.id!==`tab-${name}`);
  }

  async function onLogin(e){
    e.preventDefault();$("loginMessage").textContent="";
    try{
      const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify({email:$("email").value.trim(),password:$("password").value})});
      $("loginView").hidden=true;$("dashboardView").hidden=false;
      currentAdmin=data.admin;
      $("adminIdentity").textContent=`${data.admin.name} · ${data.admin.email} · ${data.admin.role}${data.admin.isDefault?" · DEFAULT ADMIN":""}`;
      applyAdminPermissions();
      await loadAll();
    }catch(err){showLoginView(err.message)}
  }

  async function logout(){
    await api("/api/admin/logout",{method:"POST"});
    location.reload();
  }

  function compressImage(file){
    return new Promise((resolve,reject)=>{
      if(!file){resolve("");return}
      if(file.size>5*1024*1024){reject(new Error("Ukuran foto maksimal 5 MB."));return}
      const reader=new FileReader();
      reader.onload=()=>{
        const img=new Image();
        img.onload=()=>{
          const max=900, scale=Math.min(1,max/Math.max(img.width,img.height));
          const canvas=document.createElement("canvas");
          canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
          const ctx=canvas.getContext("2d");
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL("image/jpeg",.78));
        };
        img.onerror=()=>reject(new Error("Foto tidak bisa diproses."));
        img.src=reader.result;
      };
      reader.onerror=()=>reject(new Error("Foto tidak bisa dibaca."));
      reader.readAsDataURL(file);
    });
  }

  function openToolModal(item=null){
    $("catalogModalTitle").textContent=item?"Edit alat":"Tambah alat";
    $("catalogId").value=item?.id||"";
    $("catalogName").value=item?.name||"";
    $("catalogCategory").value=item?.category||"Camping";
    $("catalogIcon").value=item?.icon||"🎒";
    $("catalogPrice").value=item?.price??25000;
    $("catalogStock").value=item?.stock??1;
    $("catalogActive").checked=item?!!item.active:true;
    $("catalogDescription").value=item?.description||"";
    $("catalogPhoto").value="";
    photoData=item?.photo||"";
    $("photoPreview").innerHTML=photoData?`<img src="${photoData}" alt="Preview">`:`<span>Belum ada foto</span>`;
    $("catalogMessage").textContent="";
    openModal("catalogModal");
  }

  async function saveTool(e){
    e.preventDefault();$("catalogMessage").textContent="";
    try{
      let payload={
        name:$("catalogName").value.trim(),
        category:$("catalogCategory").value.trim(),
        icon:$("catalogIcon").value.trim(),
        price:Number($("catalogPrice").value),
        stock:Number($("catalogStock").value),
        active:$("catalogActive").checked,
        description:$("catalogDescription").value.trim(),
        photo:photoData
      };
      const id=$("catalogId").value;
      await api(id?`/api/admin/catalog/${id}`:"/api/admin/catalog",{method:id?"PATCH":"POST",body:JSON.stringify(payload)});
      closeModal("catalogModal");toast("Katalog disimpan.");await loadAll();
    }catch(err){$("catalogMessage").textContent=err.message}
  }

  async function handleClick(e){
    const close=e.target.closest("[data-close]");if(close){closeModal(close.dataset.close);return}
    const tab=e.target.closest(".tab");if(tab){switchTab(tab.dataset.tab);return}
    if(e.target.id==="addToolBtn"){openToolModal();return}
    if(e.target.id==="addAdminBtn"){openModal("adminModal");$("adminMessage").textContent="";return}
    const approveUser=e.target.closest("[data-approve-user]");
    if(approveUser){await changeApproval("user",approveUser.dataset.approveUser,"approved");return}
    const rejectUser=e.target.closest("[data-reject-user]");
    if(rejectUser){await changeApproval("user",rejectUser.dataset.rejectUser,"rejected");return}
    const approveRental=e.target.closest("[data-approve-rental]");
    if(approveRental){await changeApproval("rental",approveRental.dataset.approveRental,"approved");return}
    const rejectRental=e.target.closest("[data-reject-rental]");
    if(rejectRental){await changeApproval("rental",rejectRental.dataset.rejectRental,"rejected");return}
    const approveExtension=e.target.closest("[data-approve-extension]");
    if(approveExtension){await changeExtensionApproval(approveExtension.dataset.approveExtension,"approved");return}
    const rejectExtension=e.target.closest("[data-reject-extension]");
    if(rejectExtension){await changeExtensionApproval(rejectExtension.dataset.rejectExtension,"rejected");return}

    const edit=e.target.closest("[data-edit-tool]");if(edit){const item=dashboard.catalog.find(x=>x.id==edit.dataset.editTool);if(item)openToolModal(item);return}
    const toggle=e.target.closest("[data-toggle-tool]");if(toggle){
      const item=dashboard.catalog.find(x=>x.id==toggle.dataset.toggleTool);if(!item)return;
      try{await api(`/api/admin/catalog/${item.id}`,{method:"PATCH",body:JSON.stringify({active:!item.active})});toast("Status alat diperbarui.");await loadAll()}catch(err){toast(err.message)}return
    }
    const del=e.target.closest("[data-delete-tool]");if(del){
      if(!confirm("Hapus alat ini? Riwayat transaksi yang terhubung tidak boleh dihapus."))return;
      try{await api(`/api/admin/catalog/${del.dataset.deleteTool}`,{method:"DELETE"});toast("Alat dihapus.");await loadAll()}catch(err){toast(err.message)}return
    }
    const rt=e.target.closest("[data-return]");if(rt){await changeRental(rt.dataset.return,"Dikembalikan");return}
    const ex=e.target.closest("[data-reactivate]");if(ex){await changeRental(ex.dataset.reactivate,"Dipinjam");return}
    const pr=e.target.closest("[data-print]");if(pr){printReceipt(Number(pr.dataset.print));return}
    const ut=e.target.closest("[data-user-toggle]");if(ut){try{await api(`/api/admin/users/${ut.dataset.userToggle}/active`,{method:"PATCH",body:JSON.stringify({active:Number(ut.dataset.active)})});await loadAll();toast("Status customer diperbarui.")}catch(err){toast(err.message)}return}
    const at=e.target.closest("[data-admin-toggle]");if(at){try{await api(`/api/admin/admins/${at.dataset.adminToggle}`,{method:"PATCH",body:JSON.stringify({active:Number(at.dataset.active)})});await loadAll();toast("Status admin diperbarui.")}catch(err){toast(err.message)}return}
  }

  async function changeApproval(type,id,status){
    const base=type==="user"?"/api/admin/users":"/api/admin/rentals";
    let reason="";
    if(status==="rejected"){
      const label=type==="user"?"akun customer":"pesanan sewa";
      reason=window.prompt(`Masukkan alasan penolakan ${label}:`,"");
      if(reason===null)return;
      reason=reason.trim();
      if(reason.length<3){
        toast("Alasan penolakan wajib diisi.");
        return;
      }
      if(!window.confirm(`Tolak ${label} dengan alasan berikut?\n\n${reason}`))return;
    }

    try{
      await api(`${base}/${id}/approval`,{
        method:"PATCH",
        body:JSON.stringify({status,reason})
      });
      if(type==="user" && status==="approved") {
        toast("Akun customer berhasil disetujui. Selanjutnya setujui pesanan sewanya di tab Transaksi.");
      } else {
        toast(status==="approved" ? "Persetujuan disimpan." : "Penolakan disimpan.");
      }
      await loadAll();
    }catch(err){
      toast(err.message);
    }
  }

  async function changeExtensionApproval(id,status){
    let reason="";
    if(status==="rejected") {
      reason=window.prompt("Masukkan alasan penolakan perpanjangan:","");
      if(reason===null)return;
      reason=reason.trim();
      if(reason.length<3){toast("Alasan penolakan wajib diisi.");return}
      if(!window.confirm(`Tolak perpanjangan dengan alasan berikut?\n\n${reason}`))return;
    }
    try {
      await api(`/api/admin/rental-extensions/${id}/approval`,{method:"PATCH",body:JSON.stringify({status,reason})});
      toast(status==="approved"?"Perpanjangan disetujui.":"Perpanjangan ditolak.");
      await loadAll();
    } catch(err) {
      toast(err.message);
    }
  }

  async function changeRental(id,status){
    try{await api(`/api/admin/rentals/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});toast("Status transaksi diperbarui.");await loadAll()}catch(err){toast(err.message)}
  }

  function printReceipt(id){
    const r=dashboard.rentals.find(x=>Number(x.id)===id);if(!r)return;
    const lines=r.items.map(i=>`<div class="row"><span>${esc(i.equipment)} × ${i.quantity}</span><span>${money(i.subtotal)}</span></div>`).join("");
    const w=window.open("","_blank","width=400,height=700");
    w.document.write(`<!doctype html><html><head><title>Struk #${id}</title><style>
      @page{size:58mm auto;margin:4mm}body{width:50mm;margin:0;font:11px monospace;color:#000}
      h1{text-align:center;font-size:13px;margin:0 0 5px}p{margin:3px 0}.sep{border-top:1px dashed #000;margin:6px 0}.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.total{font-weight:700}.center{text-align:center}
    </style></head><body>
      <h1>SUMMIT BASE</h1><div class="center">STRUK SEWA #${id}</div><div class="sep"></div>
      <p>Customer: ${esc(r.userName)}</p><p>Telp: ${esc(r.userPhone)}</p><p>Mulai: ${formatDate(r.startDate)}</p><p>Kembali: ${formatDate(r.returnDate)}</p>
      <div class="sep"></div>${lines}<div class="sep"></div>
      <div class="row total"><span>TOTAL</span><span>${money(r.totalPrice)}</span></div>
      <p>Status: ${esc(effectiveStatus(r).label)}</p><div class="sep"></div><div class="center">Terima kasih.</div>
      <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script>
    </body></html>`);
    w.document.close();
  }

  $("catalogPhoto").addEventListener("change",async()=>{try{photoData=await compressImage($("catalogPhoto").files[0]);$("photoPreview").innerHTML=photoData?`<img src="${photoData}" alt="Preview">`:`<span>Belum ada foto</span>`}catch(err){$("catalogMessage").textContent=err.message;$("catalogPhoto").value=""}});
  $("loginForm").addEventListener("submit",onLogin);
  $("catalogForm").addEventListener("submit",saveTool);

  $("adminForm").addEventListener("submit",async e=>{
    e.preventDefault();$("adminMessage").textContent="";
    try{
      await api("/api/admin/admins",{method:"POST",body:JSON.stringify({
        name:$("adminName").value.trim(),email:$("adminEmail").value.trim(),
        password:$("adminPassword").value
      })});
      closeModal("adminModal");toast("Admin ditambahkan.");await loadAll();
    }catch(err){$("adminMessage").textContent=err.message}
  });

  $("passwordForm").addEventListener("submit",async e=>{
    e.preventDefault();
    $("passwordMessage").textContent="";

    if(!currentAdmin?.isDefault){
      $("passwordMessage").textContent="Hanya DEFAULT ADMIN yang dapat mengganti password utama.";
      return;
    }

    const currentPassword=$("currentPassword").value;
    const newPassword=$("newPassword").value;
    const confirmPassword=$("confirmPassword").value;

    if(newPassword!==confirmPassword){
      $("passwordMessage").textContent="Konfirmasi password baru tidak sama.";
      return;
    }

    try{
      await api("/api/admin/change-password",{
        method:"POST",
        body:JSON.stringify({currentPassword,newPassword})
      });
      $("currentPassword").value="";
      $("newPassword").value="";
      $("confirmPassword").value="";
      toast("Password DEFAULT ADMIN berhasil diganti.");
    }catch(err){
      $("passwordMessage").textContent=err.message;
    }
  });

  $("logoutBtn").addEventListener("click",logout);
  $("rentalSearch").addEventListener("input",e=>renderRentals(e.target.value));
  $("refreshBtn").addEventListener("click",refreshDashboard);
  document.addEventListener("click",e=>{
    const toggle=e.target.closest(".password-toggle");
    if(!toggle)return;
    const input=$(toggle.dataset.passwordTarget);
    if(!input)return;
    const show=input.type==="password";
    input.type=show?"text":"password";
    toggle.textContent=show?"Sembunyikan":"Tampilkan";
    toggle.setAttribute("aria-pressed",show?"true":"false");
  });
  document.addEventListener("click",handleClick);

  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal:not([hidden])").forEach(modal => {
      closeModal(modal.id);
    });
  });

  (async function init(){
    try{
      const me=await api("/api/admin/me");
      if(me.authenticated){
        hideAllModals();
        $("loginView").hidden=true;
        $("dashboardView").hidden=false;
        currentAdmin=me.admin;
        $("adminIdentity").textContent=`${me.admin.name} · ${me.admin.email} · ${me.admin.role}${me.admin.isDefault?" · DEFAULT ADMIN":""}`;
        applyAdminPermissions();
        await loadAll();
      }else{
        showLoginView("");
      }
    }catch{
      showLoginView("");
    }
  })();
})();
