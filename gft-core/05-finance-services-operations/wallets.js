// GFT Core — wallets boundary.
export function walletSnapshot(wallet={}){return {walletId:wallet.walletId||null,balance:Number(wallet.balance||0),currency:wallet.currency||"ZAR"}}
