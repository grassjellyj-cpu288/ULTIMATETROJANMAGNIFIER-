// script7.js - SMART SHARPEN PRO ULTRA (เวอร์ชันปรับปรุง)
// รองรับ Web Worker, ยกเลิกการทำงาน, EXIF Orientation, ประสิทธิภาพสูงขึ้น

(function() {
    document.addEventListener('DOMContentLoaded', () => {
        // ========== DOM Elements ==========
        const canvas = document.getElementById('canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const zoomCanvas = document.getElementById('zoomCanvas');
        const zoomCtx = zoomCanvas?.getContext('2d');
        
        const uploadInput = document.getElementById('upload');
        const uploadBtn = document.getElementById('uploadBtn');
        const modeSelect = document.getElementById('mode');
        const saveBtn = document.getElementById('saveBtn');
        const applyBtn = document.getElementById('applyBtn');
        const resetBtn = document.getElementById('resetBtn');
        const cancelBtn = document.createElement('button'); // สร้างปุ่ม Cancel ใหม่
        
        const amountSlider = document.getElementById('amount');
        const radiusSlider = document.getElementById('radius');
        const thresholdSlider = document.getElementById('threshold');
        const preblurSlider = document.getElementById('preblur');
        const amountVal = document.getElementById('amountVal');
        const radiusVal = document.getElementById('radiusVal');
        const thresholdVal = document.getElementById('thresholdVal');
        const preblurVal = document.getElementById('preblurVal');
        
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        
        // ตัวแปรสถานะ
        let originalImageData = null;      // ImageData ต้นฉบับ (หลังปรับ orientation แล้ว)
        let originalImageElement = null;
        let currentWorker = null;
        let abortController = null;
        let isProcessing = false;
        
        // ตั้งค่าปุ่ม Cancel
        if (applyBtn && applyBtn.parentNode) {
            cancelBtn.textContent = '❌ ยกเลิก';
            cancelBtn.id = 'cancelBtn';
            cancelBtn.style.marginLeft = '10px';
            cancelBtn.style.backgroundColor = '#ff4444';
            cancelBtn.style.color = 'white';
            cancelBtn.style.border = 'none';
            cancelBtn.style.padding = '8px 16px';
            cancelBtn.style.borderRadius = '6px';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.style.display = 'none';
            applyBtn.parentNode.insertBefore(cancelBtn, applyBtn.nextSibling);
        }
        
        // ========== Helper: อ่าน EXIF orientation จากไฟล์ ==========
        function getOrientation(file) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const view = new DataView(e.target.result);
                    if (view.getUint16(0, false) !== 0xFFD8) {
                        resolve(1); // ไม่ใช่ JPEG
                        return;
                    }
                    let offset = 2;
                    let orientation = 1;
                    while (offset < view.byteLength) {
                        const marker = view.getUint16(offset, false);
                        offset += 2;
                        if (marker === 0xFFE1) { // APP1 (EXIF)
                            const length = view.getUint16(offset, false);
                            offset += 2;
                            if (view.getUint32(offset, false) === 0x45786966) { // "Exif"
                                offset += 6;
                                const end = offset + length - 10;
                                while (offset < end) {
                                    const tag = view.getUint16(offset, false);
                                    offset += 2;
                                    const type = view.getUint16(offset, false);
                                    offset += 2;
                                    const count = view.getUint32(offset, false);
                                    offset += 4;
                                    if (tag === 0x0112) { // Orientation tag
                                        if (type === 3) { // short
                                            orientation = view.getUint16(offset, false);
                                        }
                                        break;
                                    }
                                    offset += count * (type === 3 ? 2 : 4);
                                }
                            }
                            break;
                        } else if (marker === 0xFFDA) break;
                        else {
                            const length = view.getUint16(offset, false);
                            offset += length;
                        }
                    }
                    resolve(orientation);
                };
                reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
            });
        }
        
        // ฟังก์ชันหมุนภาพตาม orientation
        async function rotateImage(img, orientation) {
            const w = img.width, h = img.height;
            let sw = w, sh = h;
            let rad = 0;
            let flipX = false, flipY = false;
            switch (orientation) {
                case 2: flipX = true; break;
                case 3: rad = Math.PI; break;
                case 4: flipY = true; break;
                case 5: rad = Math.PI / 2; flipX = true; break;
                case 6: rad = Math.PI / 2; sw = h; sh = w; break;
                case 7: rad = Math.PI / 2; flipY = true; break;
                case 8: rad = -Math.PI / 2; sw = h; sh = w; break;
                default: rad = 0;
            }
            const canvasRot = document.createElement('canvas');
            canvasRot.width = sw; canvasRot.height = sh;
            const rotCtx = canvasRot.getContext('2d');
            rotCtx.translate(sw/2, sh/2);
            rotCtx.rotate(rad);
            if (flipX) rotCtx.scale(-1, 1);
            if (flipY) rotCtx.scale(1, -1);
            rotCtx.drawImage(img, -w/2, -h/2);
            return canvasRot;
        }
        
        // ========== โหลดภาพ + จัดการ orientation ==========
        async function loadImageFromFile(file) {
            if (!file) return;
            const orientation = await getOrientation(file);
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.src = url;
            await new Promise((resolve) => { img.onload = resolve; });
            let finalCanvas;
            if (orientation !== 1) {
                const rotated = await rotateImage(img, orientation);
                finalCanvas = rotated;
            } else {
                finalCanvas = document.createElement('canvas');
                finalCanvas.width = img.width;
                finalCanvas.height = img.height;
                const tmpCtx = finalCanvas.getContext('2d');
                tmpCtx.drawImage(img, 0, 0);
            }
            URL.revokeObjectURL(url);
            originalImageElement = img;
            canvas.width = finalCanvas.width;
            canvas.height = finalCanvas.height;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(finalCanvas, 0, 0);
            originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (zoomCtx) zoomCtx.clearRect(0, 0, 220, 220);
        }
        
        // ปุ่มอัปโหลด
        if (uploadBtn && uploadInput) {
            uploadBtn.addEventListener('click', () => uploadInput.click());
            uploadInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) loadImageFromFile(file);
                uploadInput.value = '';
            });
        }
        
        // ========== Web Worker (inline) ==========
        function createWorker() {
            const workerCode = `
                // Worker: LAB sharpen + Gaussian blur
                self.onmessage = async function(e) {
                    const { id, imageBuffer, width, height, amount, radius, threshold, preblur, mode } = e.data;
                    const srcData = new Uint8ClampedArray(imageBuffer);
                    let currentProgress = 0;
                    const reportProgress = (pct) => {
                        self.postMessage({ id, type: 'progress', progress: pct });
                    };
                    // LAB conversion (same as original but optimized slightly)
                    const LAB_X_REF = 0.95047, LAB_Y_REF = 1.00000, LAB_Z_REF = 1.08883, LAB_EPSILON = 0.008856;
                    function rgbToLab(r,g,b) {
                        r=r/255; g=g/255; b=b/255;
                        r=r>0.04045?Math.pow((r+0.055)/1.055,2.4):r/12.92;
                        g=g>0.04045?Math.pow((g+0.055)/1.055,2.4):g/12.92;
                        b=b>0.04045?Math.pow((b+0.055)/1.055,2.4):b/12.92;
                        let x=(r*0.4124564+g*0.3575761+b*0.1804375)/LAB_X_REF;
                        let y=(r*0.2126729+g*0.7151522+b*0.0721750)/LAB_Y_REF;
                        let z=(r*0.0193339+g*0.1191920+b*0.9503041)/LAB_Z_REF;
                        x=x>LAB_EPSILON?Math.cbrt(x):(7.787*x)+16/116;
                        y=y>LAB_EPSILON?Math.cbrt(y):(7.787*y)+16/116;
                        z=z>LAB_EPSILON?Math.cbrt(z):(7.787*z)+16/116;
                        return { l:(116*y)-16, a:500*(x-y), b:200*(y-z) };
                    }
                    function labToRgb(l,a,b) {
                        let y=(l+16)/116;
                        let x=a/500+y;
                        let z=y-b/200;
                        x=Math.pow(x,3)>LAB_EPSILON?Math.pow(x,3):(x-16/116)/7.787;
                        y=Math.pow(y,3)>LAB_EPSILON?Math.pow(y,3):(y-16/116)/7.787;
                        z=Math.pow(z,3)>LAB_EPSILON?Math.pow(z,3):(z-16/116)/7.787;
                        x*=LAB_X_REF; y*=LAB_Y_REF; z*=LAB_Z_REF;
                        let r=x*3.2404542+y*-1.5371385+z*-0.4985314;
                        let g=x*-0.9692660+y*1.8760108+z*0.0415560;
                        let b_=x*0.0556434+y*-0.2040259+z*1.0572252;
                        r=r>0.0031308?1.055*Math.pow(r,1/2.4)-0.055:r*12.92;
                        g=g>0.0031308?1.055*Math.pow(g,1/2.4)-0.055:g*12.92;
                        b_=b_>0.0031308?1.055*Math.pow(b_,1/2.4)-0.055:b_*12.92;
                        return { r:Math.min(255,Math.max(0,r*255)), g:Math.min(255,Math.max(0,g*255)), b:Math.min(255,Math.max(0,b_*255)) };
                    }
                    // Gaussian blur (separable)
                    function fastBlur(data, w, h, rad) {
                        if (rad<0.5) return data;
                        const size=Math.ceil(rad*3);
                        const kernel=[];
                        let sum=0;
                        for(let i=-size;i<=size;i++) {
                            const val=Math.exp(-(i*i)/(2*rad*rad));
                            kernel.push(val);
                            sum+=val;
                        }
                        for(let i=0;i<kernel.length;i++) kernel[i]/=sum;
                        const temp=new Uint8ClampedArray(data.length);
                        // horizontal
                        for(let y=0;y<h;y++) {
                            for(let x=0;x<w;x++) {
                                let rr=0,gg=0,bb=0,aa=0;
                                for(let k=0;k<kernel.length;k++) {
                                    const kx=Math.min(w-1,Math.max(0,x+(k-size)));
                                    const idx=(y*w+kx)*4;
                                    const wgt=kernel[k];
                                    rr+=data[idx]*wgt;
                                    gg+=data[idx+1]*wgt;
                                    bb+=data[idx+2]*wgt;
                                    aa+=data[idx+3]*wgt;
                                }
                                const idx=(y*w+x)*4;
                                temp[idx]=rr; temp[idx+1]=gg; temp[idx+2]=bb; temp[idx+3]=aa;
                            }
                        }
                        // vertical
                        const out=new Uint8ClampedArray(data.length);
                        for(let y=0;y<h;y++) {
                            for(let x=0;x<w;x++) {
                                let rr=0,gg=0,bb=0,aa=0;
                                for(let k=0;k<kernel.length;k++) {
                                    const ky=Math.min(h-1,Math.max(0,y+(k-size)));
                                    const idx=(ky*w+x)*4;
                                    const wgt=kernel[k];
                                    rr+=temp[idx]*wgt;
                                    gg+=temp[idx+1]*wgt;
                                    bb+=temp[idx+2]*wgt;
                                    aa+=temp[idx+3]*wgt;
                                }
                                const idx=(y*w+x)*4;
                                out[idx]=rr; out[idx+1]=gg; out[idx+2]=bb; out[idx+3]=aa;
                            }
                        }
                        return out;
                    }
                    reportProgress(10);
                    // Pre-blur simulation (if needed) - but we skip because original does it on canvas
                    // However original did preblur on canvas before sending; here we simulate by blurring again?
                    // We'll respect preblur value: apply gaussian blur to srcData if preblur>0
                    let workData = srcData;
                    if (preblur > 0) {
                        workData = fastBlur(srcData, width, height, preblur);
                        reportProgress(20);
                    }
                    // Main sharpen
                    const blurred = fastBlur(workData, width, height, radius);
                    reportProgress(30);
                    const outData = new Uint8ClampedArray(workData.length);
                    const TILE_SIZE = 256;
                    const totalTiles = Math.ceil(height/TILE_SIZE)*Math.ceil(width/TILE_SIZE);
                    let processedTiles=0;
                    const amt=amount, thresh=threshold;
                    const HALO_PROTECTION_FACTOR=120;
                    for(let ty=0;ty<height;ty+=TILE_SIZE) {
                        const endY=Math.min(ty+TILE_SIZE, height);
                        for(let tx=0;tx<width;tx+=TILE_SIZE) {
                            const endX=Math.min(tx+TILE_SIZE, width);
                            for(let y=ty;y<endY;y++) {
                                for(let x=tx;x<endX;x++) {
                                    const idx=(y*width+x)*4;
                                    let r=workData[idx], g=workData[idx+1], b=workData[idx+2];
                                    const br=blurred[idx], bg=blurred[idx+1], bb=blurred[idx+2];
                                    let lab=rgbToLab(r,g,b);
                                    let blurLab=rgbToLab(br,bg,bb);
                                    let mask=lab.l - blurLab.l;
                                    const edge=Math.abs(mask);
                                    if(edge>thresh) {
                                        let strength=amt;
                                        if(mode==='detail') strength*=1.4;
                                        else if(mode==='soft') strength*=0.7;
                                        const protect=1-Math.min(edge/HALO_PROTECTION_FACTOR,1);
                                        const adaptive=strength*protect;
                                        lab.l+=mask*adaptive;
                                    }
                                    const rgb=labToRgb(lab.l,lab.a,lab.b);
                                    outData[idx]=rgb.r;
                                    outData[idx+1]=rgb.g;
                                    outData[idx+2]=rgb.b;
                                    outData[idx+3]=workData[idx+3];
                                }
                            }
                            processedTiles++;
                            const pct = 30 + (processedTiles/totalTiles)*70;
                            reportProgress(Math.min(99, pct));
                            await new Promise(resolve => setTimeout(resolve, 0));
                        }
                    }
                    reportProgress(100);
                    self.postMessage({ id, type: 'result', imageBuffer: outData.buffer }, [outData.buffer]);
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            return new Worker(URL.createObjectURL(blob));
        }
        
        // ========== ใช้ Worker ทำ Sharpen ==========
        async function applySharpen() {
            if (!originalImageData) { alert('กรุณาอัปโหลดรูปภาพก่อน'); return; }
            if (isProcessing) { alert('กำลังประมวลผลอยู่'); return; }
            if (currentWorker) { currentWorker.terminate(); }
            isProcessing = true;
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
            if (progressBar) progressBar.style.display = 'block';
            updateProgress(0);
            
            const amt = parseFloat(amountSlider.value) / 100;
            const rad = parseFloat(radiusSlider.value);
            const thresh = parseFloat(thresholdSlider.value);
            const preblur = parseFloat(preblurSlider.value);
            const mode = modeSelect ? modeSelect.value : 'standard';
            
            // ถ้ามี preblur > 0 ให้ทำ blur บน canvas ก่อน (ตามเดิม)
            if (preblur > 0) {
                ctx.filter = `blur(${preblur}px)`;
                ctx.drawImage(canvas, 0, 0);
                ctx.filter = 'none';
            }
            const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const w = canvas.width, h = canvas.height;
            const imageBuffer = currentImageData.data.buffer.slice(0); // copy buffer
            
            const worker = createWorker();
            currentWorker = worker;
            const workerId = Date.now();
            let abort = false;
            abortController = { abort: () => { abort = true; worker.terminate(); isProcessing = false; cancelBtn.style.display = 'none'; updateProgress(0); if(progressBar) progressBar.style.display='none'; } };
            
            worker.postMessage({
                id: workerId,
                imageBuffer: imageBuffer,
                width: w,
                height: h,
                amount: amt,
                radius: rad,
                threshold: thresh,
                preblur: 0, // เรา blur บน canvas แล้ว
                mode: mode
            }, [imageBuffer]);
            
            worker.onmessage = (ev) => {
                if (abort) return;
                const data = ev.data;
                if (data.id !== workerId) return;
                if (data.type === 'progress') {
                    updateProgress(data.progress);
                } else if (data.type === 'result') {
                    const resultBuffer = data.imageBuffer;
                    const resultData = new Uint8ClampedArray(resultBuffer);
                    const newImageData = new ImageData(resultData, w, h);
                    ctx.putImageData(newImageData, 0, 0);
                    updateProgress(100);
                    isProcessing = false;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (progressBar) setTimeout(() => progressBar.style.display = 'none', 500);
                    currentWorker = null;
                }
            };
            worker.onerror = (err) => {
                console.error('Worker error:', err);
                isProcessing = false;
                cancelBtn.style.display = 'none';
                progressBar.style.display = 'none';
                alert('เกิดข้อผิดพลาดในการประมวลผล');
            };
            
            // ปุ่ม Cancel
            const cancelHandler = () => {
                if (currentWorker && isProcessing) {
                    currentWorker.terminate();
                    isProcessing = false;
                    cancelBtn.style.display = 'none';
                    progressBar.style.display = 'none';
                    updateProgress(0);
                    alert('ยกเลิกการปรับแต่งแล้ว');
                }
            };
            cancelBtn.onclick = cancelHandler;
        }
        
        function updateProgress(pct) {
            if (!progressFill) return;
            const percent = Math.min(100, Math.max(0, pct));
            progressFill.style.width = percent + '%';
            if (percent >= 100) {
                if(progressBar) setTimeout(()=>progressBar.style.display='none', 500);
            } else {
                if(progressBar) progressBar.style.display = 'block';
            }
        }
        
        function resetImage() {
            if (!originalImageData) return alert('ยังไม่มีภาพ');
            if (isProcessing) return alert('กำลังประมวลผล');
            ctx.putImageData(originalImageData, 0, 0);
        }
        
        function saveImageWithName() {
            if (!originalImageData) return alert('ไม่มีภาพ');
            if (isProcessing) return alert('กำลังประมวลผล');
            let name = prompt('ตั้งชื่อไฟล์', 'sharpened_pro');
            if (!name) name = 'sharpened_image';
            if (!name.endsWith('.png')) name += '.png';
            const link = document.createElement('a');
            link.download = name;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
        
        // Zoom preview
        if (canvas && zoomCtx) {
            let frame;
            const updateZoom = (x,y) => {
                const rect=canvas.getBoundingClientRect();
                const sx=canvas.width/rect.width, sy=canvas.height/rect.height;
                let cx=(x-rect.left)*sx, cy=(y-rect.top)*sy;
                if(isNaN(cx)||isNaN(cy)) return;
                cx=Math.min(Math.max(cx,30),canvas.width-30);
                cy=Math.min(Math.max(cy,30),canvas.height-30);
                zoomCtx.clearRect(0,0,220,220);
                zoomCtx.drawImage(canvas, cx-30,cy-30,60,60,0,0,220,220);
                zoomCtx.strokeStyle='#00d4ff'; zoomCtx.lineWidth=2;
                zoomCtx.beginPath(); zoomCtx.moveTo(110,0); zoomCtx.lineTo(110,220); zoomCtx.stroke();
                zoomCtx.beginPath(); zoomCtx.moveTo(0,110); zoomCtx.lineTo(220,110); zoomCtx.stroke();
                zoomCtx.fillStyle='#ff6b6b'; zoomCtx.beginPath(); zoomCtx.arc(110,110,4,0,2*Math.PI); zoomCtx.fill();
            };
            canvas.addEventListener('mousemove',(e)=>{
                if(frame) cancelAnimationFrame(frame);
                frame=requestAnimationFrame(()=>updateZoom(e.clientX,e.clientY));
            });
            canvas.addEventListener('touchmove',(e)=>{ e.preventDefault(); const t=e.touches[0]; if(t) updateZoom(t.clientX,t.clientY); },{passive:false});
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown',(e)=>{
            if(e.ctrlKey && e.key==='z'){ e.preventDefault(); resetImage(); }
            else if(e.ctrlKey && e.key==='Enter'){ e.preventDefault(); applySharpen(); }
            else if(e.ctrlKey && e.key==='s'){ e.preventDefault(); saveImageWithName(); }
        });
        
        if (applyBtn) applyBtn.addEventListener('click', applySharpen);
        if (resetBtn) resetBtn.addEventListener('click', resetImage);
        if (saveBtn) saveBtn.addEventListener('click', saveImageWithName);
        if (amountSlider && amountVal) amountSlider.addEventListener('input',()=>amountVal.innerText=amountSlider.value);
        if (radiusSlider && radiusVal) radiusSlider.addEventListener('input',()=>radiusVal.innerText=radiusSlider.value);
        if (thresholdSlider && thresholdVal) thresholdSlider.addEventListener('input',()=>thresholdVal.innerText=thresholdSlider.value);
        if (preblurSlider && preblurVal) preblurSlider.addEventListener('input',()=>preblurVal.innerText=preblurSlider.value);
        
        console.log('✅ script7.js ปรับปรุงสมบูรณ์ (Worker + Cancel + EXIF)');
    });
})();