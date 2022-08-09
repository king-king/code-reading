// import './public-path'
import Vue from 'vue'
import VueRouter from 'vue-router'
import routes from './router'
import ElementUI from 'element-ui'
import 'element-ui/lib/theme-chalk/index.css'
import './my-font/iconfont.css'
import './my-font/iconfont.js' // 引入不同类型iconfont
import App from './App.vue'

Vue.config.productionTip = false
Vue.use(ElementUI)

const router = new VueRouter({
  // vue-router在hash模式下不支持base，可以用一个根页面进行包裹
  // base: window.__MICRO_APP_BASE_ROUTE__ || '/',
  // mode: 'history',
  routes,
})

router.beforeEach((to, from, next) => {
  console.log('vue2 路由钩子 beforeEach', to, from, location.href)
  next()
})

router.afterEach((to, from) => {
  console.log('vue2 路由钩子 afterEach', to, from, location.href)
})

let app = null

// -------------------分割线-默认模式------------------ //
// app = new Vue({
//   router,
//   render: h => h(App),
// }).$mount('#app')

// // 监听卸载
// window.unmount = () => {
//   app.$destroy()
//   app.$el.innerHTML = ''
//   app = null
//   console.log('微应用vue2卸载了 -- 默认模式')
// }


// -------------------分割线-umd模式------------------ //
// 👇 将渲染操作放入 mount 函数，子应用初始化时会自动执行
window.mount = () => {
  app = new Vue({
    router,
    render: h => h(App),
  }).$mount('#app')
  console.log("微应用vue2渲染了 -- UMD模式")
}

// 👇 将卸载操作放入 unmount 函数
window.unmount = () => {
  app.$destroy()
  app.$el.innerHTML = ''
  app = null
  console.log("微应用vue2卸载了 -- UMD模式")
}

// 如果不在微前端环境，则直接执行mount渲染
if (!window.__MICRO_APP_ENVIRONMENT__) {
  window.mount()
}

// -------------------分割线------------------ //
