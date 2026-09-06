import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase.js'
import { useAuth } from '../context/AuthContext.jsx'
import trainBg from '../Train2.png'

const FlipWrap = styled.div`
  .container {
    display: flex;
    justify-content: center;
    align-items: center;
    perspective: 1400px;
  }

  .form {
    position: relative;
    width: 430px;
    height: 590px;
    display: flex;
    justify-content: center;
    align-items: center;
    transform-style: preserve-3d;
    transition: transform 1s ease;
  }

  .form .form_front,
  .form .form_back {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 22px;
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    padding: 48px 56px;
    border-radius: 18px;
    background: rgba(220, 232, 245, 0.42);
    -webkit-backdrop-filter: blur(10px) saturate(1.25);
    backdrop-filter: blur(10px) saturate(1.25);
    border: 1px solid rgba(255, 255, 255, 0.55);
    box-shadow: 0 20px 60px rgba(8, 20, 38, 0.35),
      inset 1px 1px 0 rgba(255, 255, 255, 0.6);
  }

  .form .form_back {
    transform: rotateY(-180deg);
  }

  .form_details {
    font-size: 30px;
    font-weight: 600;
    padding-bottom: 10px;
    color: #12325b;
    text-align: center;
  }

  .brand_mini {
    font-size: 12px;
    letter-spacing: 4px;
    font-weight: 800;
    color: #4a6d8f;
    margin-bottom: -8px;
  }

  .input {
    width: 300px;
    min-height: 52px;
    color: #12325b;
    outline: none;
    transition: 0.35s;
    padding: 0px 10px;
    background-color: rgba(255, 255, 255, 0.42);
    border-radius: 8px;
    border: 2px solid rgba(255, 255, 255, 0.5);
    box-shadow: 4px 4px 12px rgba(18, 50, 91, 0.12),
      -4px -4px 10px rgba(255, 255, 255, 0.5);
    font-size: 15px;
  }

  .input::placeholder {
    color: #7e9bb8;
  }

  .input:focus.input::placeholder {
    transition: 0.3s;
    opacity: 0;
  }

  .input:focus {
    transform: scale(1.05);
    background-color: rgba(255, 255, 255, 0.68);
    box-shadow: 4px 4px 12px rgba(18, 50, 91, 0.12),
      -4px -4px 10px rgba(255, 255, 255, 0.5),
      inset 3px 3px 8px rgba(18, 50, 91, 0.1),
      inset -3px -3px 8px rgba(255, 255, 255, 0.8);
  }

  .pw_wrap {
    position: relative;
    width: 300px;
  }

  .pw_wrap .input {
    width: 100%;
    padding-right: 44px;
  }

  .pw_toggle {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: #4a6d8f;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    padding: 6px 8px;
  }

  .pw_toggle:hover {
    color: #12325b;
  }

  .btn {
    padding: 13px 48px;
    cursor: pointer;
    background-color: #12325b;
    border-radius: 8px;
    border: 2px solid #12325b;
    box-shadow: 5px 5px 14px rgba(8, 20, 38, 0.4),
      -3px -3px 8px rgba(255, 255, 255, 0.35);
    color: #fff;
    font-size: 16px;
    font-weight: bold;
    transition: 0.35s;
    min-width: 190px;
  }

  .btn:hover:not(:disabled) {
    transform: scale(1.05);
    box-shadow: 5px 5px 14px rgba(8, 20, 38, 0.4),
      -3px -3px 8px rgba(255, 255, 255, 0.35),
      inset 2px 2px 8px rgba(255, 255, 255, 0.25),
      inset -2px -2px 8px rgba(0, 0, 0, 0.3);
  }

  .btn:focus {
    transform: scale(1.05);
    box-shadow: 5px 5px 14px rgba(8, 20, 38, 0.4),
      -3px -3px 8px rgba(255, 255, 255, 0.35),
      inset 2px 2px 8px rgba(255, 255, 255, 0.25),
      inset -2px -2px 8px rgba(0, 0, 0, 0.3);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form .switch {
    font-size: 13px;
    color: #12325b;
    text-align: center;
  }

  .form .switch .signup_tog {
    font-weight: 700;
    cursor: pointer;
    text-decoration: underline;
  }

  .form_note {
    font-size: 12px;
    color: #4a6d8f;
    text-align: center;
    max-width: 300px;
  }

  .form_msg {
    font-size: 13px;
    text-align: center;
    max-width: 300px;
    padding: 9px 12px;
    border-radius: 8px;
    width: 300px;
  }

  .form_msg.err {
    color: #b42318;
    background: rgba(254, 228, 226, 0.7);
    border: 1px solid #f3b8b3;
  }

  .form_msg.ok {
    color: #0e7c5b;
    background: rgba(230, 244, 238, 0.7);
    border: 1px solid #bfe3d3;
  }

  .form_msg.warn {
    color: #b54708;
    background: rgba(254, 240, 199, 0.7);
    border: 1px solid #f5d98b;
  }

  .shake {
    animation: shake 0.4s ease;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0) rotateY(0deg); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(5px); }
  }

  .form_back.shake {
    animation-name: shake_back;
  }

  @keyframes shake_back {
    0%, 100% { transform: translateX(0) rotateY(-180deg); }
    20% { transform: translateX(-8px) rotateY(-180deg); }
    40% { transform: translateX(8px) rotateY(-180deg); }
    60% { transform: translateX(-5px) rotateY(-180deg); }
    80% { transform: translateX(5px) rotateY(-180deg); }
  }

  .container #flip_toggle {
    display: none;
  }

  .container #flip_toggle:checked + .form {
    transform: rotateY(-180deg);
  }

  @media (max-width: 480px) {
    .form {
      width: 330px;
      height: 560px;
    }
    .form .form_front,
    .form .form_back {
      padding: 36px 30px;
    }
    .input, .pw_wrap, .form_msg {
      width: 250px;
    }
  }
`

export default function Login() {
  const { user, authLoading, authError, setAuthError, login, isFirebaseConfigured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [shake, setShake] = useState(0)
  const [resetEmail, setResetEmail] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetState, setResetState] = useState('idle')
  const [resetMsg, setResetMsg] = useState('')
  const nav = useNavigate()

  useEffect(() => {
    if (user) nav('/dashboard', { replace: true })
  }, [user, nav])

  const fail = (msg) => {
    setLocalError(msg)
    setShake((s) => s + 1)
  }

  const submitLogin = async (e) => {
    e.preventDefault()
    setLocalError('')
    setAuthError('')
    if (!email || !password) {
      fail('Enter your admin email and password.')
      return
    }
    setBusy(true)
    try {
      await login(email, password)
      nav('/dashboard', { replace: true })
    } catch (err) {
      const code = err?.code || ''
      if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential'))
        fail('Invalid email or password.')
      else if (code.includes('too-many-requests'))
        fail('Too many attempts. Try again later.')
      else fail(err?.message || 'Login failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async (e) => {
    e.preventDefault()
    setResetMsg('')
    setResetState('idle')
    if (!isFirebaseConfigured || !auth) {
      setResetState('error')
      setResetMsg('Firebase is not configured yet.')
      return
    }
    if (!resetEmail) {
      setResetState('error')
      setResetMsg('Enter your admin email first.')
      return
    }
    setResetBusy(true)
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim())
      setResetState('sent')
      setResetMsg('Reset link sent. Check your inbox.')
    } catch (err) {
      setResetState('error')
      setResetMsg(err?.code?.includes('invalid-email') ? 'That email address looks invalid.' : 'Could not send reset email. Try again.')
    } finally {
      setResetBusy(false)
    }
  }

  const shownError = localError || authError

  return (
    <div className="login-full">
      <img className="login-bg" src={trainBg} alt="" />
      <div className="login-scrim"></div>
      <div className="login-top">
        <span className="login-brand">TRACKORA</span>
      </div>
      <div className="login-center">
        <FlipWrap>
          <div className="container">
            <input type="checkbox" id="flip_toggle" />
            <div className="form">
              <form key={`front-${shake}`} className={`form_front${shake ? ' shake' : ''}`} onSubmit={submitLogin}>
                <div className="brand_mini">TRACKORA</div>
                <div className="form_details">Admin Login</div>
                {!isFirebaseConfigured && (
                  <div className="form_msg warn">Firebase is not configured. Fill admin-portal/.env first.</div>
                )}
                {shownError && <div className="form_msg err">{shownError}</div>}
                <input
                  placeholder="Admin email"
                  className="input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <div className="pw_wrap">
                  <input
                    placeholder="Password"
                    className="input"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="pw_toggle" onClick={() => setShowPw((s) => !s)}>
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button className="btn" type="submit" disabled={busy || authLoading}>
                  {busy ? 'Signing in...' : 'Login'}
                </button>
                <span className="switch">
                  Forgot your password?{' '}
                  <label className="signup_tog" htmlFor="flip_toggle">
                    Reset it
                  </label>
                </span>
                <div className="form_note">Restricted to users with the admin role.</div>
              </form>

              <form className="form_back" onSubmit={submitReset}>
                <div className="brand_mini">TRACKORA</div>
                <div className="form_details">Reset Password</div>
                {resetState === 'sent' && <div className="form_msg ok">{resetMsg}</div>}
                {resetState === 'error' && <div className="form_msg err">{resetMsg}</div>}
                <input
                  placeholder="Admin email"
                  className="input"
                  type="email"
                  autoComplete="username"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                />
                <button className="btn" type="submit" disabled={resetBusy}>
                  {resetBusy ? 'Sending...' : 'Send reset link'}
                </button>
                <span className="switch">
                  Remembered it?{' '}
                  <label className="signup_tog" htmlFor="flip_toggle">
                    Sign In
                  </label>
                </span>
                <div className="form_note">A secure reset link will be emailed to you.</div>
              </form>
            </div>
          </div>
        </FlipWrap>
      </div>
    </div>
  )
}
