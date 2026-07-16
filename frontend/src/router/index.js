import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/Login/index.vue'
import ReportView from '../views/Report/index.vue'
import MyFeedbackView from '../views/MyFeedbacks/index.vue'
import AdminView from '../views/Admin/index.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { guest: true } },
  { path: '/report', name: 'report', component: ReportView, meta: { auth: true } },
  { path: '/my', name: 'my', component: MyFeedbackView, meta: { auth: true } },
  {
    path: '/admin',
    component: AdminView,
    meta: { auth: true, role: 'console' },
    children: [
      { path: '', redirect: '/admin/feedbacks' },
      { path: 'feedbacks', name: 'admin-feedbacks', component: () => import('../views/Admin/FeedbackApproval/index.vue') },
      { path: 'users', name: 'admin-users', component: () => import('../views/Admin/UserManagement/index.vue') },
      { path: 'projects', name: 'admin-projects', component: () => import('../views/Admin/ProjectManagement/index.vue') }
    ]
  },
  { path: '/', redirect: '/report' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')

  if (to.meta.guest && token) {
    return next('/report')
  }

  if (to.meta.auth && !token) {
    return next('/login')
  }

  if (to.meta.role) {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const hasAccess = (to.meta.role === 'admin' && user.role === 'admin') ||
                      (to.meta.role === 'console' && (user.role === 'admin' || user.role === 'developer'))

    if (!hasAccess) {
      return next('/report')
    }
  }

  // 对所有需要 auth 的路由进行非阻塞二次验证，防止重启后端导致 token 在前端“假存活”
  if (to.meta.auth) {
    fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) {
          if (res.status === 401) {
            console.warn('[Security] 登录已失效，自动重定向到登录页');
            localStorage.clear();
            window.location.href = '/login';
          }
          throw new Error('Unauthenticated');
        }
        return res.json();
      })
      .then(data => {
        if (to.meta.role) {
          const remoteUser = data.user || {}
          const hasRemoteAccess = (to.meta.role === 'admin' && remoteUser.role === 'admin') ||
                                  (to.meta.role === 'console' && (remoteUser.role === 'admin' || remoteUser.role === 'developer'))
          if (!hasRemoteAccess) {
            console.warn('[Security] 远端角色核验失败，强行退出');
            localStorage.clear();
            window.location.href = '/login';
          }
        }
      })
      .catch(() => {
        // 容错：允许通过（实际操作时后端仍会进行 JWT 阻拦）
      });
  }

  next()
})

export default router
