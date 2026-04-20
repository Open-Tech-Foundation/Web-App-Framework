import { signal } from "@preact/signals"

export default function SignupForm() {
  const username = signal("")
  const email = signal("")
  const password = signal("")
  const status = signal("")

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!username.value || !email.value || !password.value) {
      status.value = "❌ Please fill in all fields"
      return
    }

    status.value = "⏳ Creating your account..."

    setTimeout(() => {
      status.value = `✅ Welcome aboard, ${username.value}!`
      console.log({ username: username.value, email: email.value, password: password.value })
    }, 2000)
  }

  return (
    <div class="signup-card">
      <h2 class="green">Join WAF</h2>
      <p class="subtitle">Experience the future of zero-VDOM apps</p>

      <form onsubmit={handleSubmit}>
        <div class="form-group">
          <label>Username</label>
          <input
            type="text"
            placeholder="johndoe"
            value={username.value}
            oninput={(e) => username.value = e.target.value}
          />
        </div>

        <div class="form-group">
          <label>Email Address</label>
          <input
            type="email"
            placeholder="john@example.com"
            value={email.value}
            oninput={(e) => email.value = e.target.value}
          />
        </div>

        <div class="form-group">
          <label>Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password.value}
            oninput={(e) => password.value = e.target.value}
          />
        </div>

        <button type="submit">Create Account</button>
      </form>

      <div class="status-msg">
        {status.value}
      </div>
    </div>
  )
}
