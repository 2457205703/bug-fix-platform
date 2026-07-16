const BASE = '/api'

function authHeaders() {
  const token = localStorage.getItem('token')
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers }
  })
  
  if (res.status === 401) {
    console.warn('[API] 登录失效，清除缓存并重定向');
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  return res.json()
}

// Auth
export function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
}

export function getMe() {
  return request('/auth/me')
}

// Users (admin)
export function getUsers() {
  return request('/users')
}

export function createUser(data) {
  return request('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function updateUser(id, data) {
  return request(`/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function disableUser(id) {
  return request(`/users/${id}/disable`, { method: 'PUT' })
}

export function enableUser(id) {
  return request(`/users/${id}/enable`, { method: 'PUT' })
}

// Feedbacks
export async function submitFeedback(formData) {
  const res = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData
  })
  
  if (res.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  return res.json()
}

export function getFeedbacks(status) {
  const params = status ? `?status=${status}` : ''
  return request(`/feedbacks${params}`)
}

export function getMyFeedbacks() {
  return request('/feedbacks/mine')
}

export function getFeedback(id) {
  return request(`/feedback/${id}`)
}

export function approveFeedback(id, skipReview = false) {
  return request(`/feedback/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipReview })
  })
}

export function rejectFeedback(id) {
  return request(`/feedback/${id}/reject`, { method: 'POST' })
}

export function updateFeedbackDesc(id, data) {
  const body = typeof data === 'string' ? { description: data } : data
  return request(`/feedback/${id}/description`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export function resetPassword(id, password) {
  return request(`/users/${id}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
}

export function continueFix(id, instruction) {
  return request(`/feedback/${id}/continue-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction })
  })
}

export function queueFix(id, instruction) {
  return request(`/feedback/${id}/queue-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction })
  })
}

export function stopFix(id) {
  return request(`/feedback/${id}/stop-fix`, { method: 'POST' })
}

export function deleteFeedback(id) {
  return request(`/feedback/${id}`, { method: 'DELETE' })
}

// Projects
export function getProjects() {
  return request('/projects')
}

export function createProject(data) {
  return request('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function updateProject(id, data) {
  return request(`/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export function deleteProject(id) {
  return request(`/projects/${id}`, { method: 'DELETE' })
}
