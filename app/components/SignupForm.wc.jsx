import { signal } from "@preact/signals"
import styles from "./SignupForm.module.css"

export default function SignupForm() {
  const username = signal("")
  const email = signal("")
  const password = signal("")
  const status = signal("")

  onMount(() => {
    console.log("SignupForm mounted")
  })

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
    <div class={styles.card}>
      <h2 class={`${styles.title} green`}>Join WAF</h2>
      <p class={styles.subtitle}>Experience the future of zero-VDOM apps</p>

      <form onsubmit={handleSubmit}>
        <div class={styles.formGroup}>
          <label class={styles.label}>Username</label>
          <input
            class={styles.input}
            type="text"
            placeholder="johndoe"
            value={username.value}
            oninput={(e) => username.value = e.target.value}
          />
        </div>

        <div class={styles.formGroup}>
          <label class={styles.label}>Email Address</label>
          <input
            class={styles.input}
            type="email"
            placeholder="john@example.com"
            value={email.value}
            oninput={(e) => email.value = e.target.value}
          />
        </div>

        <div class={styles.formGroup}>
          <label class={styles.label}>Password</label>
          <input
            class={styles.input}
            type="password"
            placeholder="••••••••"
            value={password.value}
            oninput={(e) => password.value = e.target.value}
          />
        </div>

        <button type="submit" class={styles.button}>Create Account</button>
      </form>

      <div class={styles.statusMsg}>
        {status.value}
      </div>
    </div>
  )
}
