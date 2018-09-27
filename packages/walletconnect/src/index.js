/* global window Promise */

import { Connector, Listener } from 'js-walletconnect-core'

const localStorageId = 'wcsmngt'
let localStorage = null
if (
  typeof window !== 'undefined' &&
  typeof window.localStorage !== 'undefined'
) {
  localStorage = window.localStorage
}

export default class WalletConnect extends Connector {
  //
  //  Initiate session
  //
  async initSession() {
    let liveSession = null

    const savedSession = this.getLocalSession()

    if (savedSession) {
      if (savedSession.expires > Date.now()) {
        this.sessionId = savedSession.sessionId
        this.symKey = savedSession.symKey

        const sessionStatus = await this.getSessionStatus()

        if (sessionStatus) {
          liveSession = {
            ...savedSession,
            accounts: sessionStatus.accounts,
            expires: sessionStatus.expires
          }
        }
      } else {
        this.deleteLocalSession(savedSession)
      }
    }

    let currentSession = liveSession || null

    if (currentSession) {
      this.accounts = currentSession.accounts
      this.bridgeUrl = currentSession.bridgeUrl
      this.sessionId = currentSession.sessionId
      this.symKey = currentSession.symKey
      this.dappName = currentSession.dappName
      this.expires = currentSession.expires
    } else {
      currentSession = await this.createSession()
    }

    return currentSession
  }

  //
  // Create new session
  //
  async createSession() {
    this.symKey = await this.generateKey()

    const body = await this._fetchBridge('/session/new', {
      method: 'POST'
    })

    this.sessionId = body.sessionId
    this.expires = body.expires
    this.accounts = []

    const session = this.toJSON()
    this.saveLocalSession(session)

    return session
  }

  //
  //  Get Accounts
  //
  async getAccounts() {
    let accounts = this.accounts
    if (!accounts && !accounts.length) {
      return accounts
    }
    try {
      accounts = await this.createCallRequest({
        method: 'eth_accounts'
      })
      this.accounts = accounts
      return accounts
    } catch (error) {
      throw new Error('Rejected: Accounts Request')
    }
  }

  //
  // Send Transaction
  //
  async sendTransaction(tx = {}) {
    try {
      const result = await this.createCallRequest({
        method: 'eth_sendTransaction',
        params: [tx]
      })
      return result
    } catch (error) {
      throw new Error('Rejected: Signed Transaction Request')
    }
  }

  //
  // Sign Message
  //
  async signMessage(msg) {
    try {
      const result = await this.createCallRequest({
        method: 'eth_sign',
        params: [msg]
      })
      return result
    } catch (error) {
      throw new Error('Rejected: Signed Message Request')
    }
  }

  //
  //  Sign Typed Data
  //
  async signTypedData(msgParams) {
    try {
      const result = await this.createCallRequest({
        method: 'eth_signTypedData',
        params: [msgParams]
      })
      return result
    } catch (error) {
      throw new Error('Rejected: Signed TypedData Request')
    }
  }

  //
  // Create call
  //
  async createCallRequest(data) {
    if (!this.sessionId) {
      throw new Error(
        'Create session using `initSession` before creating a call'
      )
    }

    const payload = this.createPayload(data)

    // encrypt data
    const encryptedPayload = await this.encrypt(payload)

    // store call data on bridge
    const body = await this._fetchBridge(
      `/session/${this.sessionId}/call/new`,
      {
        method: 'POST'
      },
      {
        data: encryptedPayload,
        dappName: this.dappName
      }
    )

    const response = await this.listenCallStatus(body.callId)

    if (response.success) {
      const { result } = response
      return result
    } else {
      throw new Error('Rejected Call Request')
    }
  }

  //
  // Get session status
  //
  async getSessionStatus() {
    if (!this.sessionId) {
      throw new Error('sessionId is required')
    }
    const result = await this._getEncryptedData(`/session/${this.sessionId}`)

    if (result) {
      this.expires = result.expires
      this.accounts = result.data

      const session = this.toJSON()
      this.saveLocalSession(session)

      return session
    }
    return null
  }

  //
  // Get call status
  //
  async getCallStatus(callId) {
    if (!this.sessionId || !callId) {
      throw new Error('sessionId and callId are required')
    }

    const result = await this._getEncryptedData(`/call-status/${callId}`)

    if (result) {
      return result.data
    }

    return null
  }

  //
  // Listen for session status
  //
  listenSessionStatus(pollInterval = 1000, timeout = 60000) {
    return new Promise((resolve, reject) => {
      new Listener({
        fn: async() => await this.getSessionStatus(),
        cb: (err, result) => {
          if (err) {
            reject(err)
          }
          resolve(result)
        },
        pollInterval,
        timeout
      })
    })
  }

  //
  // Listen for call status
  //
  listenCallStatus(callId, pollInterval = 1000, timeout = 60000) {
    return new Promise((resolve, reject) => {
      new Listener({
        fn: async() => await this.getCallStatus(callId),
        cb: (err, result) => {
          if (err) {
            reject(err)
          }
          resolve(result)
        },
        pollInterval,
        timeout
      })
    })
  }

  // -- localStorage -------------------------------------------------------- //

  getLocalSession() {
    let savedSession = null
    const savedLocal = localStorage && localStorage.getItem(localStorageId)
    if (savedLocal) {
      savedSession = this.checkObject(savedLocal, 'local session')
    }
    return savedSession
  }

  saveLocalSession(session) {
    localStorage.setItem(localStorageId, JSON.stringify(session))
  }

  deleteLocalSession() {
    localStorage.removeItem(localStorageId)
  }
}
