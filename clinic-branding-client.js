(() => {
  const form=document.getElementById('clinicIconEditor');if(!form)return;
  const status=document.getElementById('clinicIconStatus'),input=document.getElementById('clinicIconFile'),preview=document.getElementById('clinicIconPreview');let version=0;
  async function api(path,options){const response=await fetch('/api/clinic/public/branding'+path,{cache:'no-store',...options});const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to load Clinic icon settings.');return result;}
  async function load(){try{await api('/authority');const result=await api('');version=result.version;form.hidden=false;preview.src='/api/clinic/public/icon/192?v='+version;status.textContent='Choose an image to update the Clinic logo and browser/app icons.';}catch(error){form.hidden=true;status.textContent=error.message;}}
  async function prepare(file){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('Choose a JPG, PNG or WebP image under 8 MB.');
    const bitmap=await createImageBitmap(file);const images={};
    try{for(const size of [192,512]){const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d');ctx.fillStyle='#0B2942';ctx.fillRect(0,0,size,size);const scale=Math.min(size/bitmap.width,size/bitmap.height);ctx.drawImage(bitmap,(size-bitmap.width*scale)/2,(size-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);images['icon'+size]=canvas.toDataURL('image/png');}}finally{bitmap.close();}
    if(JSON.stringify(images).length>900000)throw Error('This image is too detailed for an icon. Please choose a simpler logo.');return images;
  }
  input.onchange=async()=>{try{const images=await prepare(input.files[0]);preview.src=images.icon192;status.textContent='Preview ready. Save to apply the icon.';}catch(error){status.textContent=error.message;}};
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const images=await prepare(input.files[0]);const result=await api('',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...images,version})});version=result.version;status.textContent='Clinic icon saved. Installed-app icons may take time to refresh in the browser.';input.value='';preview.src='/api/clinic/public/icon/192?v='+version;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
  load();
})();
