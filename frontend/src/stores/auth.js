import { defineStore } from 'pinia'
import * as api from '../api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    loading: false
  }),

  getters: {
    isLoggedIn: (state) => !!state.token && !!state.user,
    isAdmin: (state) => state.user?.role === 'admin',
    isDeveloper: (state) => state.user?.role === 'developer',
    isReporter: (state) => state.user?.role === 'reporter' || state.user?.role === 'user',
    hasConsoleAccess: (state) => state.user?.role === 'admin' || state.user?.role === 'developer',
    displayName: (state) => state.user?.displayName || state.user?.username || ''
  },

  actions: {
    async login(username, password) {
      this.loading = true
      try {
        const res = await api.login(username, password)
        if (res.error) return { error: res.error }
        this.token = res.token
        this.user = res.user
        localStorage.setItem('token', res.token)
        localStorage.setItem('user', JSON.stringify(res.user))
        return { success: true }
      } catch (e) {
        return { error: '网络错误' }
      } finally {
        this.loading = false
      }
    },

    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    },

    async checkAuth() {
      if (!this.token) return false
      try {
        const res = await api.getMe()
        if (res.user) {
          this.user = res.user
          localStorage.setItem('user', JSON.stringify(res.user))
          return true
        }
      } catch { /* ignore */ }
      this.logout()
      return false
    }
  }
})
