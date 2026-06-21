declare global {
  namespace NodeJS {
    interface ProcessEnv {
      WIF: string
      WIF2: string
      WIF3: string
      ADDRESS: string
      ADDRESS2: string
      ADDRESS3: string
      NETWORK: string
      METASV_BEARER: string
    }
  }
}

export {}
