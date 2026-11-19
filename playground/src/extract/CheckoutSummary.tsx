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
        <h2>{t('checkout_order_summary')}</h2>
        <button aria-label={t('checkout_close_dialog')} onClick={onClose}>×</button>
      </header>
      <p>{t('cart.total', { amount: 42 })}</p>
      <label>
        {t('checkout_coupon')}
        <input placeholder={t('checkout_coupon_placeholder')} />
      </label>
      <button>{t('checkout.apply_coupon')}</button>
      <h3>{t('checkout_ShippingAddress')}</h3>
      <p>{t('checkout_arrival_days', { days })}</p>
      <p>
        {t('checkout_spring_sale')}
      </p>
      <footer>
        <button onClick={onClose}>{t('cancel')}</button>
        <button onClick={submit}>{t('checkout_place_order')}</button>
        <a href="/login">{t('auth.login.submit')}</a>
        <a href="/forgot">{t('auth-forgot-password')}</a>
      </footer>
    </section>
  )
}

declare function track(event: string): void
