import React,{useEffect,useRef,useState} from 'react'
import {QRCodeSVG} from 'qrcode.react'
import {BrowserQRCodeReader} from '@zxing/browser'
import Station from './Station'
import {Activity,Users,CalendarDays,ChartNoAxesCombined,Settings,Camera,LogOut,BookOpen,ClipboardList,ShieldCheck,Menu,Plus,RefreshCw,CheckCircle2,AlertTriangle,Clock,ScanFace,GraduationCap,Bell,ArrowRight,Search,PlayCircle,UserCheck,Database} from 'lucide-react'

const api = async (path, opts={}) => {
  const token=localStorage.getItem('attendx_token')
  const isFormData = opts.body instanceof FormData
  const headers = {
    ...(!isFormData ? {'Content-Type':'application/json'} : {}),
    ...(token ? {Authorization:`Bearer ${token}`} : {}),
    ...(opts.headers || {})
  }
  const res=await fetch('/api'+path,{...opts,headers})
  const data=await res.json().catch(()=>({detail:'Unexpected server response'}))
  if(!res.ok) throw new Error(data.detail||'Request failed')
  return data
}
const fmt=(v)=>v?new Date(v).toLocaleString(): '—'


function ProfilePhotoSubmission(){
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [streaming,setStreaming] = useState(false)
  const [captured,setCaptured] = useState(null)
  const [previewUrl,setPreviewUrl] = useState('')
  const [savedUrl,setSavedUrl] = useState('')
  const [status,setStatus] = useState('not_submitted')
  const [submittedAt,setSubmittedAt] = useState(null)
  const [consent,setConsent] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')

  const stopCamera = () => {
    if(streamRef.current){
      streamRef.current.getTracks().forEach(track=>track.stop())
      streamRef.current = null
    }
    if(videoRef.current) videoRef.current.srcObject = null
    setStreaming(false)
  }

  useEffect(()=>{
    let active = true
    const loadPhoto = async()=>{
      try{
        const info = await api('/profile-photo')
        if(!active) return
        setStatus(info.status)
        setSubmittedAt(info.submitted_at || null)
        if(info.status === 'submitted'){
          const token = localStorage.getItem('attendx_token')
          const response = await fetch('/api/profile-photo/image',{
            headers: token ? {Authorization:`Bearer ${token}`} : {},
            cache:'no-store'
          })
          if(!response.ok) throw new Error('Could not load your submitted photo.')
          const blob = await response.blob()
          if(active) setSavedUrl(URL.createObjectURL(blob))
        }
      }catch(err){
        if(active) setError(err.message || 'Unable to load photo status.')
      }
    }
    loadPhoto()
    return ()=>{active=false}
  },[])

  useEffect(()=>()=>{if(previewUrl) URL.revokeObjectURL(previewUrl)},[previewUrl])
  useEffect(()=>()=>{if(savedUrl) URL.revokeObjectURL(savedUrl)},[savedUrl])
  useEffect(()=>()=>{stopCamera()},[])

  const startCamera = async()=>{
    setError('')
    setMessage('')
    try{
      if(!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera access requires HTTPS or localhost.')
      const media = await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'user'}},
        audio:false
      })
      streamRef.current = media
      if(videoRef.current){
        videoRef.current.srcObject = media
        await videoRef.current.play()
      }
      setStreaming(true)
    }catch(err){
      stopCamera()
      setError(err.message || 'Unable to access your device camera.')
    }
  }

  const capturePhoto = ()=>{
    const video = videoRef.current
    if(!video || !video.videoWidth){
      setError('Camera is not ready yet. Please wait and try again.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video,0,0)
    canvas.toBlob(blob=>{
      if(!blob){
        setError('Could not capture the photo. Please try again.')
        return
      }
      setCaptured(blob)
      setPreviewUrl(URL.createObjectURL(blob))
      setError('')
      stopCamera()
    },'image/jpeg',0.88)
  }

  const retake = ()=>{
    setCaptured(null)
    setPreviewUrl('')
    setMessage('')
    startCamera()
  }

  const submitPhoto = async()=>{
    if(!captured || !consent) return
    setBusy(true)
    setError('')
    setMessage('')
    try{
      const form = new FormData()
      form.append('image',captured,'profile-photo.jpg')
      form.append('consent','true')
      const result = await api('/profile-photo',{method:'POST',body:form})
      const token = localStorage.getItem('attendx_token')
      const response = await fetch('/api/profile-photo/image',{
        headers: token ? {Authorization:`Bearer ${token}`} : {},
        cache:'no-store'
      })
      if(!response.ok) throw new Error('Photo saved, but preview could not be refreshed.')
      const blob = await response.blob()
      setSavedUrl(URL.createObjectURL(blob))
      setStatus(result.status)
      setSubmittedAt(result.submitted_at)
      setCaptured(null)
      setPreviewUrl('')
      setConsent(false)
      setMessage('Your profile photo has been submitted successfully.')
    }catch(err){
      setError(err.message || 'Photo submission failed.')
    }finally{
      setBusy(false)
    }
  }

  const deletePhoto = async()=>{
    if(!window.confirm('Delete your submitted profile photo?')) return
    setBusy(true)
    setError('')
    try{
      await api('/profile-photo',{method:'DELETE'})
      setSavedUrl('')
      setStatus('not_submitted')
      setSubmittedAt(null)
      setMessage('Your submitted photo has been deleted.')
    }catch(err){
      setError(err.message || 'Could not delete the photo.')
    }finally{
      setBusy(false)
    }
  }

  return <div className="panel">
    <h3>Student profile photo</h3>
    <p className="muted">Submit a profile photo from your own device. You can review it before submitting and replace it later.</p>

    {status === 'submitted' && savedUrl && <div className="notice">
      <strong>Photo submitted</strong>
      <p className="muted">Submitted: {submittedAt ? new Date(submittedAt).toLocaleString() : 'Date unavailable'}</p>
      <img src={savedUrl} alt="Your submitted profile photo" style={{width:'100%',maxWidth:'240px',display:'block',borderRadius:'12px',marginTop:'12px'}}/>
      <button className="secondary" type="button" disabled={busy} onClick={()=>{setCaptured(null);setPreviewUrl('');setMessage('');startCamera()}}>Update Photo</button>
      <button className="secondary" type="button" disabled={busy} onClick={deletePhoto}>Delete Photo</button>
    </div>}

    {status !== 'submitted' && <p className="notice">No profile photo has been submitted yet.</p>}

    {!captured && <>
      <video ref={videoRef} autoPlay playsInline muted style={{width:'100%',maxWidth:'480px',background:'#111',borderRadius:'12px',display:streaming?'block':'none'}}/>
      {!streaming && <button className="primary" type="button" disabled={busy} onClick={startCamera}>Open Device Camera</button>}
      {streaming && <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'12px'}}>
        <button className="primary" type="button" onClick={capturePhoto}>Capture Photo</button>
        <button className="secondary" type="button" onClick={stopCamera}>Cancel Camera</button>
      </div>}
    </>}

    {captured && <div style={{marginTop:'16px'}}>
      <h4>Review your photo</h4>
      <img src={previewUrl} alt="Profile photo preview before submission" style={{width:'100%',maxWidth:'320px',display:'block',borderRadius:'12px'}}/>
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'12px'}}>
        <button className="secondary" type="button" disabled={busy} onClick={retake}>Retake Photo</button>
      </div>
      <label style={{display:'flex',gap:'9px',alignItems:'flex-start',marginTop:'16px'}}>
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>I voluntarily agree to submit this image as my profile photo. I understand it is not used for biometric recognition.</span>
      </label>
      <button className="primary" type="button" disabled={!consent || busy} onClick={submitPhoto} style={{marginTop:'12px'}}>
        {busy?'Submitting…':'Submit Profile Photo'}
      </button>
    </div>}

    {message && <p className="notice">{message}</p>}
    {error && <p role="alert" style={{color:'#b42318'}}>{error}</p>}
    <hr/>
    <h4>Privacy information</h4>
    <ul>
      <li>This is an ordinary profile photo submission, not biometric enrollment.</li>
      <li>No face templates, embeddings, or facial matching are created.</li>
      <li>Your photo is available only through your authenticated student account in this version.</li>
      <li>You can replace or delete your submitted photo.</li>
    </ul>
    <p className="muted">Biometric recognition and automatic attendance remain disabled. Teachers continue to use manual attendance.</p>
  </div>
}


function WebcamPreview(){
  const videoRef = useRef(null);
  const [stream,setStream] = useState(null);
  const [error,setError] = useState('');

  const startCamera = async () => {
    setError('');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires localhost or HTTPS.');
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });

      videoRef.current.srcObject = mediaStream;
      setStream(mediaStream);

    } catch (err) {
      setError(err.message || 'Unable to access webcam.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  return (
    <div className="panel">
      <h3>MacBook Built-in Webcam</h3>
      <p className="muted">Test your webcam connection.</p>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          maxWidth: '600px',
          background: '#111',
          borderRadius: '12px'
        }}
      />

      {!stream ? (
        <button className="primary" onClick={startCamera}>
          Start Webcam
        </button>
      ) : (
        <button className="secondary" onClick={stopCamera}>
          Stop Webcam
        </button>
      )}

      {error && <p>{error}</p>}
    </div>
  );
}


function CameraStreamViewer({ cameraId, onClose, onQrDetected, scannedStudents = [] }) {
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const resourceRef = useRef(null);
  const [status, setStatus] = useState('Connecting...');
  const [error, setError] = useState('');
  const onQrDetectedRef = useRef(onQrDetected);
  onQrDetectedRef.current = onQrDetected;

  useEffect(() => {
    if (!onQrDetected || status !== 'Connected') return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let controls = null;
    let started = false;
    let startTimer = null;
    let lastText = '';
    let lastAt = 0;
    const reader = new BrowserQRCodeReader();

    const startScanner = () => {
      if (cancelled || started) return;

      if (
        !video.srcObject ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !video.videoWidth ||
        !video.videoHeight
      ) return;

      started = true;

      reader.decodeFromVideoElement(video, (result, scanError) => {
        if (cancelled || !result) return;

        const value = result.getText().trim();
        if (!value) return;

        const now = Date.now();
        if (value === lastText && now - lastAt < 2500) return;

        lastText = value;
        lastAt = now;
        onQrDetectedRef.current?.(value);
      }).then(scannerControls => {
        if (cancelled) scannerControls.stop();
        else controls = scannerControls;
      }).catch(err => {
        started = false;
        if (!cancelled) {
          console.warn('QR scanner could not start:', err);
        }
      });
    };

    video.addEventListener('loadeddata', startScanner);
    video.addEventListener('canplay', startScanner);
    startTimer = setInterval(startScanner, 500);
    startScanner();

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', startScanner);
      video.removeEventListener('canplay', startScanner);
      if (startTimer) clearInterval(startTimer);
      controls?.stop();
    };
  }, [cameraId, status, Boolean(onQrDetected)]);

  useEffect(() => {
    let cancelled = false;
    let connecting = false;
    let retryTimer = null;
    let attempts = 0;

    const cleanupPeer = async (peer) => {
      if (peerRef.current === peer) {
        peerRef.current = null;
      }

      const resource = resourceRef.current;
      resourceRef.current = null;

      peer?.close();

      const token = localStorage.getItem('attendx_token');

      if (resource && token) {
        try {
          await fetch(resource, {
            method: 'DELETE',
            headers: {
              Authorization: 'Basic ' + btoa('admin:' + token)
            }
          });
        } catch (err) {
          console.warn('Viewer session cleanup failed.');
        }
      }
    };

    const scheduleReconnect = (message = 'Connection interrupted') => {
      if (cancelled || retryTimer) return;

      const delay = Math.min(2000 * Math.pow(2, attempts), 15000);
      attempts += 1;

      setStatus(`Reconnecting in ${Math.ceil(delay / 1000)}s...`);

      retryTimer = setTimeout(async () => {
        retryTimer = null;

        if (cancelled) return;

        const currentPeer = peerRef.current;

        if (currentPeer?.connectionState === 'connected') {
          attempts = 0;
          setStatus('Connected');
          return;
        }

        if (connecting) {
          scheduleReconnect('Waiting for previous attempt');
          return;
        }

        await cleanupPeer(currentPeer);

        if (!cancelled) connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled || connecting) return;

      connecting = true;
      setError('');
      setStatus('Connecting...');

      let peer = null;

      try {
        const token = localStorage.getItem('attendx_token');

        if (!token) {
          throw new Error('Admin login token not found.');
        }

        peer = new RTCPeerConnection({ iceServers: [] });
        peerRef.current = peer;

        peer.ontrack = (event) => {
          if (cancelled || peerRef.current !== peer) return;

          if (videoRef.current) {
            if (event.streams?.[0]) {
              videoRef.current.srcObject = event.streams[0];
            } else {
              videoRef.current.srcObject = new MediaStream([event.track]);
            }

            videoRef.current.play().catch(() => {});
          }
        };

        peer.onconnectionstatechange = () => {
          if (cancelled || peerRef.current !== peer) return;

          if (peer.connectionState === 'connected') {
            if (retryTimer) {
              clearTimeout(retryTimer);
              retryTimer = null;
            }

            attempts = 0;
            setError('');
            setStatus('Connected');
          } else if (
            peer.connectionState === 'failed' ||
            peer.connectionState === 'disconnected'
          ) {
            scheduleReconnect('Camera connection interrupted');
          }
        };

        peer.addTransceiver('video', { direction: 'recvonly' });

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        await new Promise((resolve, reject) => {
          if (peer.iceGatheringState === 'complete') return resolve();

          const timeout = setTimeout(
            () => reject(new Error('ICE gathering timed out.')),
            10000
          );

          const checkState = () => {
            if (peer.iceGatheringState === 'complete') {
              clearTimeout(timeout);
              peer.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };

          peer.addEventListener('icegatheringstatechange', checkState);
          checkState();
        });

        if (cancelled || peerRef.current !== peer) return;

        const auth = 'Basic ' + btoa('admin:' + token);

        const response = await fetch(`/camera-${cameraId}/whep`, {
          method: 'POST',
          headers: {
            Authorization: auth,
            'Content-Type': 'application/sdp'
          },
          body: peer.localDescription.sdp
        });

        if (!response.ok) {
          throw new Error(
            `Stream request failed (${response.status}): ${await response.text()}`
          );
        }

        const location = response.headers.get('Location');

        if (location) {
          const resource = new URL(location, window.location.origin);
          resourceRef.current = resource.pathname + resource.search;
        }

        const answer = await response.text();

        if (cancelled || peerRef.current !== peer) return;

        await peer.setRemoteDescription({
          type: 'answer',
          sdp: answer
        });

        if (!cancelled && peer.connectionState === 'connected') {
          setStatus('Connected');
        } else if (!cancelled) {
          setStatus('Waiting for camera stream...');
        }

      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to connect to camera.');
          setStatus('Connection failed — retrying...');
        }

        if (peer && peerRef.current === peer) {
          await cleanupPeer(peer);
        }

        if (!cancelled) {
          scheduleReconnect('Viewer connection failed');
        }

      } finally {
        connecting = false;
      }
    };

    connect();

    return () => {
      cancelled = true;

      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      const token = localStorage.getItem('attendx_token');
      const resource = resourceRef.current;

      if (resource && token) {
        fetch(resource, {
          method: 'DELETE',
          headers: {
            Authorization: 'Basic ' + btoa('admin:' + token)
          }
        }).catch(() => {});
      }

      peerRef.current?.close();
      peerRef.current = null;
      resourceRef.current = null;

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [cameraId]);



  return (
    <div className="panel">
      <div className="actions" style={{justifyContent:'space-between'}}>
        <h3>Live Camera — {cameraId}</h3>
        <button className="mini red" onClick={onClose}>Close viewer</button>
      </div>
      <p className="muted">Status: {status}</p>
      {error && <div className="notice">{error}</div>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          maxHeight: '480px',
          background: '#111',
          borderRadius: '10px',
          objectFit: 'contain'
        }}
      />
      {scannedStudents.length > 0 && (
        <div className="notice" style={{marginTop:'12px'}}>
          <strong>Scanned Students — Present (Pending Save)</strong>
          <p className="muted">{scannedStudents.length} student(s) scanned</p>
          {scannedStudents.map(student => (
            <div key={student.id} style={{
              padding:'10px 0',
              borderTop:'1px solid var(--border, #ccc)'
            }}>
              <strong>{student.name}</strong>
              <p className="muted">
                Enrollment: {student.enrollment_no || 'Not available'}
              </p>
              <small className="muted">Scanned at: {student.scannedAt}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function StudentProfileQR({notify}) {
 const [token,setToken]=useState('')
 const [loading,setLoading]=useState(true)
 const [rotating,setRotating]=useState(false)

 useEffect(()=>{
  let active=true
  api('/profile-qr')
   .then(r=>{if(active)setToken(r.token)})
   .catch(e=>{if(active)notify(e.message)})
   .finally(()=>{if(active)setLoading(false)})
  return ()=>{active=false}
 },[])

 const rotate=async()=>{
  setRotating(true)
  try{
   const r=await api('/profile-qr/rotate',{method:'POST'})
   setToken(r.token)
   notify('Your QR code has been refreshed. The previous code is no longer valid.')
  }catch(e){
   notify(e.message)
  }finally{
   setRotating(false)
  }
 }

 return <div className="panel" style={{marginTop:18}}>
  <h3>My Attendance QR</h3>
  <p className="muted">Show this QR code to your teacher during attendance. Your QR contains a secure token, not your enrollment number. The teacher must verify and confirm attendance.</p>
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14,padding:'18px 8px'}}>
   {loading ? <p className="muted">Loading your QR code...</p> :
    token ? <QRCodeSVG value={token} size={220} level="M" includeMargin /> :
    <p className="muted">QR code could not be loaded. Please refresh the page.</p>}
   <button className="secondary" type="button" onClick={rotate} disabled={!token||rotating}>
    {rotating?'Refreshing...':'Refresh QR code'}
   </button>
  </div>
 </div>
}

function App(){
 const [user,setUser]=useState(null),[page,setPage]=useState('Dashboard'),[busy,setBusy]=useState(false),[toast,setToast]=useState(''),[menu,setMenu]=useState(false)
 const [login,setLogin]=useState(true),[auth,setAuth]=useState({email:'',password:'',name:'',role:'student',mobile:'',enrollment_no:'',employee_id:'',department:'BAMS',year:'1st Year',branch:'BAMS'})
 const [data,setData]=useState({}),[form,setForm]=useState({}),[selected,setSelected]=useState({})
 const qrScanBusyRef=useRef(false)
 useEffect(()=>{const t=localStorage.getItem('attendx_token');if(t)api('/auth/me').then(setUser).catch(()=>localStorage.removeItem('attendx_token'))},[])
 useEffect(()=>{if(user)load()},[user,page])
 if(window.location.pathname === '/station') return <Station/>
 function notify(m){setToast(m);setTimeout(()=>setToast(''),4000)}
 async function load(){
   const endpoints={Dashboard:user?.role==='admin'?'/admin/overview':user?.role==='student'?'/analytics':'/subjects',Users:'/users',Subjects:'/subjects',Classrooms:'/classrooms',Cameras:'/cameras',Schedules:'/schedules',Attendance:'/attendance',Requests:'/attendance-requests','Biometric status':'/biometric/status'}
   const ep=endpoints[page]
   if(ep)try{const result=await api(ep);setData(d=>({...d,[page]:result}))}catch(e){notify(e.message)}
   if(page === 'Cameras'){
  try {
    const classrooms = await api('/classrooms');
    setData(d => ({...d, Classrooms: classrooms}));
  } catch(e) {
    notify(e.message);
  }
}
   if(page==='Subjects' && user?.role==='admin'){
     try {
       const teachers = await api('/users');
       const options = teachers
         .filter(t => t.role==='teacher' && t.status==='approved' && t.active!==false)
         .map(t => ({
           value: t.id,
           label: `${t.name} (${t.employee_id || t.email})`
         }));
       setData(d => ({...d, Users: teachers, teacher_id_options: options}));
     } catch(e) {
       notify(e.message);
     }
   }

   if(page==='Schedules'){
     try {
       const [subjects, classrooms] = await Promise.all([
         api('/subjects'),
         api('/classrooms')
       ]);

       setData(d => ({
         ...d,
         Subjects: subjects,
         Classrooms: classrooms,
         subject_id_options: subjects.map(x => ({
           value: x.id,
           label: `${x.name} (${x.code})`
         })),
         classroom_id_options: classrooms.map(x => ({
           value: x.id,
           label: `${x.name} (${x.department})`
         })),
         day_options: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(x => ({
           value: x,
           label: x
         }))
       }));
     } catch(e) {
       notify(e.message);
     }
   }

   if(page==='Attendance' && user?.role!=='student'){
     try{
       const [students,cameras]=await Promise.all([
         api('/students'),
         api('/cameras')
       ]);
       setData(d=>({...d,Students:students,Cameras:cameras}));
     }catch(e){notify(e.message)}
   }
 }
 useEffect(()=>{
   if(!user || page !== 'Cameras') return;

   const timer = setInterval(async()=>{
     try {
       const cameras = await api('/cameras');
       setData(d=>({...d, Cameras:cameras}));
     } catch(e) {}
   }, 10000);

   return ()=>clearInterval(timer);
 },[user,page]);

 const signIn=async e=>{e.preventDefault();setBusy(true);try{const r=await api('/auth/login',{method:'POST',body:JSON.stringify({email:auth.email,password:auth.password})});localStorage.setItem('attendx_token',r.access_token);setUser(r.user);setPage('Dashboard')}catch(e){notify(e.message)}finally{setBusy(false)}}
 const signUp=async e=>{e.preventDefault();setBusy(true);try{const body={...auth};delete body.email;const r=await api('/auth/register',{method:'POST',body:JSON.stringify(auth)});notify(r.message);setLogin(true)}catch(e){notify(e.message)}finally{setBusy(false)}}
 const logout=()=>{localStorage.removeItem('attendx_token');setUser(null);setData({});setPage('Dashboard')}
 const run=async(fn)=>{setBusy(true);try{await fn();await load()}catch(e){notify(e.message)}finally{setBusy(false)}}
 if(!user)return <div className="auth-shell"><div className="auth-visual"><div className="brand"><span className="brand-mark">A</span> AttendX</div><div><span className="eyebrow">AI-BASED SMART ATTENDANCE</span><h1>Smarter Attendance.<br/><em>Better Insights.</em></h1><p>One connected platform for students, teachers and administrators.</p><div className="feature-list"><span><ScanFace/> Biometric enrollment</span><span><Camera/> Classroom camera management</span><span><ChartNoAxesCombined/> Attendance analytics</span></div></div><small>ATTENDX · CLASSROOM ANALYTICS</small></div><div className="auth-panel"><div className="auth-card"><div className="mobile-brand">ATTENDX</div><span className="eyebrow">{login?'WELCOME BACK':'JOIN ATTENDX'}</span><h2>{login?'Sign in to your account':'Create your account'}</h2><p className="muted">{login?'Access your role-based dashboard.':'Student and teacher accounts require admin approval.'}</p><form onSubmit={login?signIn:signUp}>{!login&&<><label>Full name<input required value={auth.name} onChange={e=>setAuth({...auth,name:e.target.value})} placeholder="Your full name"/></label><label>Account type<select value={auth.role} onChange={e=>setAuth({...auth,role:e.target.value})}><option value="student">Student</option><option value="teacher">Teacher</option></select></label><label>{auth.role==='student'?'Enrollment number':'Employee ID'}<input required value={auth.role==='student'?auth.enrollment_no:auth.employee_id} onChange={e=>setAuth({...auth,[auth.role==='student'?'enrollment_no':'employee_id']:e.target.value})}/></label><label>Department / Branch<input required value={auth.department} onChange={e=>setAuth({...auth,department:e.target.value,branch:e.target.value})}/></label>{auth.role==='student'&&<label>Academic year<input value={auth.year} onChange={e=>setAuth({...auth,year:e.target.value})}/></label>}<label>Mobile number<input required value={auth.mobile} onChange={e=>setAuth({...auth,mobile:e.target.value})}/></label></>}<label>Email address<input type="email" required value={auth.email} onChange={e=>setAuth({...auth,email:e.target.value})} placeholder="name@college.edu"/></label><label>Password<input type="password" required minLength="8" value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})} placeholder="At least 8 characters"/></label><button className="primary full" disabled={busy}>{busy?'Please wait…':login?'Sign in':'Submit registration'} <ArrowRight size={17}/></button></form><div className="switch-auth">{login?"Don't have an account?":"Already registered?"} <button onClick={()=>setLogin(!login)}>{login?'Create account':'Sign in'}</button></div><p className="tiny muted">Admin accounts are created securely through the backend setup command.</p></div></div>{toast&&<div className="toast">{toast}</div>}</div>
 const nav=user.role==='student'?[['Dashboard',Activity],['Biometric status',ScanFace],['Attendance',ClipboardList],['Schedules',CalendarDays],['Requests',Bell],['Profile',Users]]:user.role==='teacher'?[['Dashboard',Activity],['Subjects',BookOpen],['Schedules',CalendarDays],['Attendance',ClipboardList],['Requests',Bell],['Students',Users]]:[['Dashboard',Activity],['Users',Users],['Subjects',BookOpen],['Classrooms',GraduationCap],['Cameras',Camera],['Schedules',CalendarDays],['Attendance',ClipboardList],['Requests',Bell]]
 const title=page==='Biometric status'?'Profile photo submission':page
 const refresh=()=>load()
 const card = (label, value, Icon, sub) => (
  <div className="stat-card">
    <div className="stat-top">
      <span>{label}</span>
      <Icon size={18} />
    </div>
    <strong>{value ?? '—'}</strong>
    <small>{sub || ''}</small>
  </div>
);
 const table=(heads,rows)=> <div className="table-wrap"><table><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>):<tr><td colSpan={heads.length} className="empty">No records yet.</td></tr>}</tbody></table></div>
 
const addForm = (kind, fields, endpoint) => (
  <div className="panel">
    <h3>Add {kind}</h3>
    <form
      className="grid-form"
      onSubmit={e => {
        e.preventDefault();
        run(async () => {
          await api(endpoint, {
            method: 'POST',
            body: JSON.stringify(form)
          });
          setForm({});
          notify(`${kind} saved.`);
        });
      }}
    >
      {fields.map(([k, label, type = 'text', optional = false]) => (
        <label key={k}>
          {label}
          {type === 'select' ? (
            <select
              required={!optional}
              value={form[k] || ''}
              onChange={e =>
                setForm({ ...form, [k]: e.target.value })
              }
            >
              <option value="">Select</option>
              {(data[k + '_options'] || []).map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              required={!optional}
              type={type}
              value={form[k] || ''}
              onChange={e =>
                setForm({ ...form, [k]: e.target.value })
              }
            />
          )}
        </label>
      ))}
      <button type="submit">Save {kind}</button>
    </form>
  </div>
);

 const startClass=async id=>{
  const schedule=(data.Schedules||[]).find(s=>String(s.id)===String(id));
  const r=await api(`/sessions/${id}/start`,{method:'POST'});
  setSelected(old=>({
    ...old,
    session:r.session_id,
    manualSession:r.session_id,
    sessionScheduleId:id,
    sessionClassroomId:schedule?.classroom_id,
    mode:r.mode,
    attendanceCameraId:null,
    liveCameraId:null
  }));
  notify(r.message);
}
 const render=()=>{
  if(page==='Dashboard'&&user.role==='admin'){const d=data.Dashboard||{};return <><div className="stats">{card('Students',d.students,Users,'Registered accounts')}{card('Teachers',d.teachers,GraduationCap,'Registered accounts')}{card('Pending approvals',d.pending,Clock,'Awaiting review')}{card('Online cameras',`${d.online_cameras||0}/${d.cameras||0}`,Camera,'Verified camera status')}</div><div className="panel"><h3>Admin overview</h3><p className="muted">Manage accounts, classrooms, cameras and attendance from one place.</p><div className="quick-grid"><button onClick={()=>setPage('Users')}>Review registrations <ArrowRight/></button><button onClick={()=>setPage('Cameras')}>Manage cameras <ArrowRight/></button><button onClick={()=>setPage('Classrooms')}>Manage classrooms <ArrowRight/></button></div></div></>}
  if(page==='Dashboard'&&user.role==='student'){const d=data.Dashboard||{};return <><div className="welcome"><div><span className="eyebrow">STUDENT OVERVIEW</span><h2>Hello, {user.name?.split(' ')[0]}.</h2><p className="muted">Here is your attendance snapshot.</p></div><div className="percentage">{d.percentage||0}%<small>Attendance</small></div></div><div className="stats">{card('Classes recorded',d.total,CalendarDays)}{card('Present',d.present,CheckCircle2)}{card('Absent',d.absent,AlertTriangle)}{card('Class average',`${d.class_average||0}%`,ChartNoAxesCombined)}</div><div className="panel"><h3>Attendance insight</h3><p className="muted">Your attendance is calculated from saved attendance records. Class average is based on available records.</p></div></>}
  if(page==='Dashboard'&&user.role==='teacher')return <><div className="welcome"><div><span className="eyebrow">TEACHER OVERVIEW</span><h2>Welcome, {user.name?.split(' ')[0]}.</h2><p className="muted">Manage your subjects and scheduled classes.</p></div><button className="primary" onClick={()=>setPage('Schedules')}>View schedule <ArrowRight/></button></div><div className="stats">{card('Assigned subjects',(data.Subjects||[]).length,BookOpen)}{card('Scheduled classes',(data.Schedules||[]).length,CalendarDays)}{card('Attendance records',(data.Attendance||[]).length,ClipboardList)}</div></>
  if(page==='Users'){const list=data.Users||[];return <div className="panel"><h3>Account management</h3><p className="muted">Approve student and teacher registrations. Passwords are never visible.</p>{table(['Name','Role','Enrollment / Employee ID','Email','Department','Status','Action'],list.map(u=>[u.name,u.role,u.role==='student'?(u.enrollment_no||'—'):u.role==='teacher'?(u.employee_id||'—'):'—',u.email,u.department,u.status,<div className="actions">{u.status==='pending'?<><button className="mini green" onClick={()=>run(()=>api(`/users/${u.id}/approval?approved=true`,{method:'PATCH'}))}>Approve</button><button className="mini red" onClick={()=>run(()=>api(`/users/${u.id}/approval?approved=false`,{method:'PATCH'}))}>Reject</button></>:<span className="muted">{u.active?'Active':'Disabled'}</span>}</div>]))}</div>}
  if(page==='Subjects')return <>{user.role==='admin'&&addForm('Subject',[['name','Subject name'],['code','Subject code'],['department','Department'],['teacher_id','Assigned teacher (optional)','select',true]],'/subjects') }<div className="panel"><h3>Subjects</h3>{table(['ID','Name','Code','Department','Assigned Teacher'],(data.Subjects||[]).map(s=>{const t=(data.Users||[]).find(u=>String(u.id)===String(s.teacher_id)) || (user.role==='teacher' && String(user.id)===String(s.teacher_id) ? user : null);return [s.id,s.name,s.code,s.department,t?`${t.name} (${t.employee_id||t.email})`:'Unassigned']}))}</div></>
  if(page==='Classrooms')return <>{addForm('Classroom',[['name','Classroom name'],['department','Department'],['capacity','Capacity','number']],'/classrooms')}<div className="panel"><h3>Classrooms</h3> {table(['ID','Name','Department','Capacity'],(data.Classrooms||[]).map(c=>[c.id,c.name,c.department,c.capacity]))}</div></>
    if(page==='Cameras')return <>
    <div className="panel">
      <h3>Register Camera Device</h3>
      <p className="muted">
        Register MacBook, Android, laptop or IP CCTV cameras and assign them to a classroom.
      </p>

      <form className="grid-form" onSubmit={e=>{
        e.preventDefault();
        run(async()=>{
          const deviceType = form.camera_device_type || 'macbook';
          const isIpCamera = deviceType === 'ip_cctv';

          await api('/cameras',{
            method:'POST',
            body:JSON.stringify({
              name:form.camera_name,
              camera_type:isIpCamera ? 'rtsp' : 'webcam',
              device_type:deviceType,
              stream_url:isIpCamera ? form.camera_stream_url : undefined,
              username:isIpCamera ? (form.camera_username || '') : '',
              password:isIpCamera ? (form.camera_password || '') : '',
              classroom_id:form.camera_classroom_id
            })
          });

          setForm({});
          notify('Camera registered successfully.');
          await load();
        });
      }}>
        <label>
          Camera name
          <input required placeholder="e.g. Classroom 1 Camera"
            value={form.camera_name||''}
            onChange={e=>setForm({...form,camera_name:e.target.value})}/>
        </label>

        <label>
          Device type
          <select required
            value={form.camera_device_type||'macbook'}
            onChange={e=>setForm({...form,camera_device_type:e.target.value})}>
            <option value="macbook">MacBook Webcam</option>
            <option value="android">Android Phone Camera</option>
            <option value="laptop">Other Laptop Webcam</option>
            <option value="ip_cctv">IP CCTV Camera</option>
          </select>
        </label>

        {form.camera_device_type==='ip_cctv' && <>
          <label className="full-row">
            RTSP Stream URL
            <input required placeholder="rtsp://camera-address:554/stream"
              value={form.camera_stream_url||''}
              onChange={e=>setForm({...form,camera_stream_url:e.target.value})}/>
          </label>

          <label>
            Camera username (optional)
            <input value={form.camera_username||''}
              onChange={e=>setForm({...form,camera_username:e.target.value})}/>
          </label>

          <label>
            Camera password (optional)
            <input type="password" value={form.camera_password||''}
              onChange={e=>setForm({...form,camera_password:e.target.value})}/>
          </label>
        </>}

        <label>
          Select classroom
          <select required value={form.camera_classroom_id||''}
            onChange={e=>setForm({...form,camera_classroom_id:e.target.value})}>
            <option value="">Select classroom</option>
            {(data.Classrooms||[]).map(c=>(
              <option key={c.id} value={c.id}>
                {c.name} — {c.department}
              </option>
            ))}
          </select>
        </label>

        <button className="primary" type="submit">Register Camera</button>
      </form>
    </div>

    <div className="panel">
      <h3>Registered Cameras</h3>
      <p className="muted">
        Generate a temporary pairing code for MacBook, Android and laptop stations.
        IP CCTV cameras use their network stream.
      </p>

      {table(
        ['Camera','Device','Classroom','Status','Last seen','Pairing action'],
        (data.Cameras||[]).map(c=>[
          c.name,
          c.device_type==='macbook'?'MacBook Webcam':
          c.device_type==='android'?'Android Phone':
          c.device_type==='laptop'?'Other Laptop':'IP CCTV',
          c.classroom,
          c.status === 'online' ? 'Online' : c.status === 'offline' ? 'Offline' : c.paired ? 'Paired' : c.status,
          c.last_seen ? fmt(c.last_seen) : '—',
          <div className="actions">
            {c.device_type!=='ip_cctv' && !c.paired &&
              <button className="mini green" onClick={()=>run(async()=>{
                const r=await api(`/cameras/${c.id}/pairing-code`,{method:'POST'});
                setSelected(old=>({
                  ...old,
                  pairingCodes:{...(old.pairingCodes||{}),[c.id]:r.pairing_code},
                  pairingExpiries:{...(old.pairingExpiries||{}),[c.id]:r.expires_at}
                }));
                notify('Pairing code generated. Share it only with the intended device.');
              })}>Generate code</button>
            }

            {c.paired &&
              <button className="mini red" onClick={()=>run(async()=>{
                await api(`/cameras/${c.id}/revoke-device`,{method:'POST'});
                setSelected(old=>({
                  ...old,
                  pairingCodes:{...(old.pairingCodes||{}),[c.id]:null}
                }));
                notify('Device pairing revoked.');
              })}>Revoke</button>
            }

            {selected.pairingCodes?.[c.id] &&
              <div className="notice">
                <b>One-time pairing code</b>
                <p><code>{selected.pairingCodes[c.id]}</code></p>
                <small>Expires: {fmt(selected.pairingExpiries?.[c.id])}</small>
                <p className="muted">Open /station on the device you want to pair.</p>
              </div>
            }
            {c.device_type !== 'ip_cctv' && c.paired &&
              <button className="mini green" onClick={() =>
                setSelected(old => ({...old, liveCameraId: c.id}))
              }>View Live</button>
            }
          </div>
        ])
      )}
      {selected.liveCameraId && (
        <CameraStreamViewer
          cameraId={selected.liveCameraId}
          onClose={() => setSelected(old => ({...old, liveCameraId: null}))}
        />
      )}
    </div>
  </>;
if(page==='Schedules')return <>{addForm('Class schedule',[['subject_id','Subject','select'],['classroom_id','Classroom','select'],['day','Day','select'],['start_time','Start time','time'],['end_time','End time','time']],'/schedules')}<div className="panel"><h3>Class schedule</h3>{table(['Day','Time','Subject ID','Classroom ID','Action'],(data.Schedules||[]).map(s=>[s.day,`${s.start_time}–${s.end_time}`,s.subject_id,s.classroom_id,<button className="mini green" onClick={()=>run(()=>startClass(s.id))}>Start class <PlayCircle size={14}/></button>]))}{selected.session&&<div className="notice"><strong>Active session:</strong> {selected.session} · {selected.mode}<p>Use manual attendance below when camera recognition is not integrated or camera is unavailable.</p><button className="primary" onClick={()=>setPage('Attendance')}>Open attendance</button></div>}</div></>
  if(page==='Students')return <div className="panel"><h3>Students</h3>{table(['Name','Enrollment','Department','Year'],(data.Students||[]).map(s=>[s.name,s.enrollment_no,s.department,s.year]))}</div>
  if(page==='Attendance'){
    const list=data.Attendance||[];
    return <>
      {user.role!=='student'&&<div className="panel">
        <h3>Live classroom camera</h3>
        <p className="muted">Scan a student's registered QR code using this live stream. QR matching only suggests a roster entry; verify the student yourself and confirm before marking attendance. No face recognition is used.</p>
        {(()=>{
          const cameras=(data.Cameras||[]).filter(c=>
            (!selected.sessionClassroomId || String(c.classroom_id)===String(selected.sessionClassroomId)) &&
            c.status==='online' && c.verified && c.paired
          );
          return cameras.length ? <label>Verified online camera
            <select value={selected.attendanceCameraId||''} onChange={e=>setSelected(old=>({...old,attendanceCameraId:e.target.value}))}>
              <option value="">Select camera</option>
              {cameras.map(c=><option key={c.id} value={c.id}>{c.name} — {c.classroom}</option>)}
            </select>
          </label> : <p className="muted">No verified, paired, online camera is available for this classroom. You can still use manual attendance.</p>;
        })()}
        {selected.attendanceCameraId&&<CameraStreamViewer
          cameraId={selected.attendanceCameraId}
          scannedStudents={selected.qrScannedStudents || []}
          onClose={()=>setSelected(old=>({...old,attendanceCameraId:null}))}
          onQrDetected={selected.manualSession ? async token => {
            if (qrScanBusyRef.current) return;
            qrScanBusyRef.current = true;
            try {
              const r = await api(`/sessions/${selected.manualSession}/qr-scan`, {
                method: 'POST',
                body: JSON.stringify({token})
              });

              if (r.status === 'already_marked') {
                notify('Attendance for this student is already saved in this session.');
                return;
              }

              if (r.status !== 'matched' || !r.student) {
                notify('QR code could not be matched to an eligible student.');
                return;
              }

              const rosterStudent = (data.Students || []).find(
                student => String(student.id) === String(r.student.id)
              );

              if (!rosterStudent) {
                notify('This student is not in the currently loaded teacher roster.');
                return;
              }

              if (selected.manual?.[r.student.id] === 'present') {
                notify(`${r.student.name} is already marked Present in this pending list.`);
                return;
              }

              setSelected(old => ({
                ...old,
                manual: {...(old.manual || {}), [r.student.id]: 'present'},
                qrScannedStudents: [
                  ...(old.qrScannedStudents || []).filter(
                    student => String(student.id) !== String(r.student.id)
                  ),
                  {
                    ...r.student,
                    scannedAt: new Date().toLocaleTimeString()
                  }
                ],
                finalSummary: null
              }));
              notify(`${r.student.name} scanned — Present pending save.`);
            } catch (e) {
              notify(e.message);
            } finally {
              qrScanBusyRef.current = false;
            }
          } : undefined}
        />}

        {selected.qrPendingStudent&&<div className="panel">
          <h3>Verify scanned student</h3>
          <p><strong>{selected.qrPendingStudent.name}</strong></p>
          <p className="muted">Enrollment: {selected.qrPendingStudent.enrollment_no || 'Not available'}</p>
          <p className="muted">Verify that the person is physically present. Confirming saves this student's Present attendance immediately.</p>
          <div className="actions">
            <button className="primary" type="button" disabled={busy} onClick={async()=>{
              const student = selected.qrPendingStudent;
              if (!student || !selected.manualSession) return;
              setBusy(true);
              try {
                const r = await api(`/sessions/${selected.manualSession}/manual-attendance`, {
                  method:'POST',
                  body:JSON.stringify({records:[{student_id:student.id,status:'present'}]})
                });
                if (r.saved !== 1) throw new Error('Attendance could not be saved for this student.');
                setSelected(old=>({
                  ...old,
                  manual:{...(old.manual||{}),[student.id]:'present'},
                  qrPendingStudent:null,
                  finalSummary:null
                }));
                notify(`Present attendance saved for ${student.name}.`);
                const records = await api('/attendance');
                setData(d=>({...d,Attendance:records}));
              } catch(e) {
                notify(e.message);
              } finally {
                setBusy(false);
              }
            }}>Confirm Present & Save</button>
            <button className="secondary" type="button" onClick={()=>
              setSelected(old=>({...old,qrPendingStudent:null}))
            }>Dismiss</button>
          </div>
        </div>}
      </div>}
      <div className="panel">
        <h3>Attendance records</h3>
        {table(
          ['Student Name','Enrollment ID','Session','Status','Verification Status','Source','Date','Request'],
          list.map(a=>[
            a.student_name||'Unknown student',
            a.enrollment_no||'—',
            a.session_id,
            a.status,
            a.verification_status==='teacher_corrected'?'Teacher corrected':
              a.verification_status==='teacher_approved'?'Teacher approved':
              a.verification_status||'Not verified',
            a.source,
            fmt(a.created_at),
            user.role==='student'
              ? <button className="mini" onClick={()=>{
                  const reason=window.prompt('Explain why this attendance record needs correction:');
                  if(reason&&reason.trim().length>=5){
                    run(()=>api('/attendance-requests',{
                      method:'POST',
                      body:JSON.stringify({attendance_id:a.id,reason})
                    }));
                  }
                }}>Request correction</button>
              : '—'
          ])
        )}
      </div>

      {user.role!=='student'&&<div className="panel">
        <h3>Manual attendance</h3>
        <p className="muted">Review the registered student roster and select each student's attendance status. Your selections remain temporary until you save them.</p>

        <form className="grid-form" onSubmit={e=>{
          e.preventDefault();
          run(async()=>{
            const records=(data.Students||[]).map(s=>({
              student_id:s.id,
              status:selected.manual?.[s.id]||''
            }));
            if(records.some(r=>!r.status)){
              notify('Please select an attendance status for every student.');
              return;
            }
            const r=await api(`/sessions/${selected.manualSession}/manual-attendance`,{
              method:'POST',
              body:JSON.stringify({records})
            });
            setSelected(old=>({
              ...old,
              manual:{},
              qrScannedStudents:[],
              finalSummary:null
            }));
            notify(`${r.saved} attendance records saved. ${r.skipped?.length||0} skipped.`);
          });
        }}>
          <label>Active session ID
            <input required value={selected.manualSession||''} onChange={e=>setSelected({...selected,manualSession:e.target.value,finalSummary:null})}/>
          </label>

          <p className="muted">
            Marked: {Object.values(selected.manual||{}).filter(Boolean).length} / {(data.Students||[]).length}
          </p>
          <div className="full-row">
            {(data.Students||[]).map(s=><label className="manual-row" key={s.id}>
              <span>
                <strong>{s.name}</strong>
                <small className="muted" style={{display:'block'}}>Enrollment: {s.enrollment_no||'Not available'}</small>
              </span>
              <select value={selected.manual?.[s.id]||''} onChange={e=>setSelected(old=>({...old,manual:{...(old.manual||{}),[s.id]:e.target.value}}))}>
                <option value="">Select status</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
                <option value="excused">Excused</option>
              </select>
            </label>)}
          </div>

          <button type="submit" className="primary" disabled={!data.Students?.length || Object.values(selected.manual||{}).filter(Boolean).length!==data.Students.length}>
            Save Attendance
          </button>
        </form>

        {selected.manualSession&&<button className="secondary" onClick={()=>run(async()=>{
          const r=await api(`/sessions/${selected.manualSession}/finalize`,{method:'POST'});
          setSelected(old=>({...old,finalSummary:r.summary}));
          notify(r.message);
        })}>Finalize session</button>}

        {selected.finalSummary&&<div className="notice">
          <h4>Final attendance summary</h4>
          <p>Total: {selected.finalSummary.total}</p>
          <p>Present: {selected.finalSummary.present}</p>
          <p>Absent: {selected.finalSummary.absent}</p>
          <p>Late: {selected.finalSummary.late}</p>
          <p>Excused: {selected.finalSummary.excused}</p>
        </div>}
      </div>}
    </>;
  }

  if(page==='Biometric status')return <ProfilePhotoSubmission/>;
  if(page==='Requests'){
    const list=data.Requests||[];
    return <div className="panel">
      <h3>Attendance correction requests</h3>
      {table(['Student','Reason','Status','Action'],list.map(r=>[
        r.student_id,
        r.reason,
        r.status,
        ['teacher','admin'].includes(user.role)&&r.status==='pending'
          ? <div className="actions">
              <select
                value={selected.requestStatus?.[r.id]||''}
                onChange={e=>setSelected(old=>({
                  ...old,
                  requestStatus:{
                    ...(old.requestStatus||{}),
                    [r.id]:e.target.value
                  }
                }))}
              >
                <option value="">Select corrected status</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
                <option value="excused">Excused</option>
              </select>
              <button
                className="mini green"
                disabled={!selected.requestStatus?.[r.id]}
                onClick={()=>run(async()=>{
                  await api(`/attendance-requests/${r.id}?decision=accepted&corrected_status=${selected.requestStatus[r.id]}`,{method:'PATCH'});
                  await load();
                })}
              >Accept</button>
              <button
                className="mini red"
                onClick={()=>run(async()=>{
                  await api(`/attendance-requests/${r.id}?decision=rejected`,{method:'PATCH'});
                  await load();
                })}
              >Reject</button>
            </div>
          : '—'
      ]))}
    </div>
  }
  if(page==='Profile')return <><div className="panel"><h3>Profile</h3><p><b>{user.name}</b></p><p>{user.email}</p><p>{user.role} · {user.department}</p></div>{user.role==='student'&&<StudentProfileQR notify={notify}/>}</>
  return <div className="panel"><h3>{title}</h3><p className="muted">Select a section from the navigation.</p></div>
 }
 return <div className="app-shell"><aside className={`sidebar ${menu?'open':''}`}><div className="brand"><span className="brand-mark">A</span> AttendX</div><div className="role-label">{user.role} PORTAL</div><nav>{nav.map(([label,Icon])=><button key={label} className={page===label?'active':''} onClick={()=>{setPage(label);setMenu(false)}}><Icon size={18}/>{label}</button>)}</nav><div className="side-bottom"><div className="user-chip"><div className="avatar">{user.name?.[0]}</div><div><b>{user.name}</b><small>{user.role}</small></div></div><button className="logout" onClick={logout}><LogOut size={17}/> Sign out</button></div></aside><main className="main"><header className="topbar"><button className="menu-btn" onClick={()=>setMenu(!menu)}><Menu/></button><div><span className="eyebrow">ATTENDANCE & CLASSROOM ANALYTICS</span><h1>{title}</h1></div><div className="top-actions"><button className="icon-btn" onClick={refresh}><RefreshCw size={18}/></button><div className="avatar">{user.name?.[0]}</div></div></header><section className="content">{render()}</section><footer>© {new Date().getFullYear()} AttendX · Smarter Attendance. Better Insights.</footer></main>{toast&&<div className="toast">{toast}</div>}</div>
}
export default App
