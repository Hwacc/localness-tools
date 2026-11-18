import { t } from '../i18n'

const ORDERS_URL = '/api/orders'

export function CheckoutSummary({ days, onClose }: { days: number; onClose: () => void }) {
  console.log('CheckoutSummary mounted')
  const submit = async () => {
    await fetch(ORDERS_URL, { method: 'POST' })
    track('checkout_submit')
  }
  return (
    <section className="checkout-summary" data-testid="checkout-summary">
      <header>
        <h2>Order summary</h2>
        <button aria-label="Close dialog" onClick={onClose}>×</button>
      </header>
      <p>{t('cart.total', { amount: 42 })}</p>
      <label>
        Coupon
        <input placeholder="Enter coupon code" />
      </label>
      <button>Apply coupon</button>
      <h3>Shipping address</h3>
      <p>Your order will arrive in {days} days.</p>
      <p>
        Spring sale: take 20% off every order over $50 until the end of the month.
      </p>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button onClick={submit}>Place order</button>
        <a href="/login">Sign in</a>
        <a href="/forgot">Forgot password?</a>
      </footer>
    </section>
  )
}

declare function track(event: string): void
