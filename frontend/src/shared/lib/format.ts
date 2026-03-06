export function formatMoney(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
) {
  if (amount == null || amount === '') return null

  const numericAmount = typeof amount === 'number' ? amount : Number(amount)
  if (Number.isNaN(numericAmount)) {
    return currency ? `${amount} ${currency}` : String(amount)
  }

  if (!currency) {
    return numericAmount.toLocaleString()
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(numericAmount)
  } catch {
    return `${numericAmount.toLocaleString()} ${currency}`
  }
}
