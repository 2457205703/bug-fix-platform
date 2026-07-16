import { defineStore } from 'pinia'
import * as api from '../api'

export const useFeedbackStore = defineStore('feedback', {
  state: () => ({
    loading: false,
    feedbacks: [],
    currentFeedback: null
  }),

  actions: {
    async submit(formData) {
      this.loading = true
      try {
        return await api.submitFeedback(formData)
      } finally {
        this.loading = false
      }
    },

    async fetchFeedbacks(status) {
      this.loading = true
      try {
        const data = await api.getFeedbacks(status)
        this.feedbacks = data.feedbacks || []
        return this.feedbacks
      } finally {
        this.loading = false
      }
    },

    async fetchFeedback(id) {
      const data = await api.getFeedback(id)
      this.currentFeedback = data.feedback
      return data.feedback
    },

    async approve(id, password) {
      this.loading = true
      try {
        return await api.approveFeedback(id, password)
      } finally {
        this.loading = false
      }
    },

    async reject(id, password) {
      this.loading = true
      try {
        return await api.rejectFeedback(id, password)
      } finally {
        this.loading = false
      }
    },

    pollFixResult(id) {
      return new Promise((resolve) => {
        const check = async () => {
          const data = await api.getFeedback(id)
          if (data.feedback && data.feedback.status !== 'approved') {
            resolve(data.feedback)
          } else {
            setTimeout(check, 2000)
          }
        }
        check()
      })
    }
  }
})
