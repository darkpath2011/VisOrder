import * as THREE from 'three'
import { PointerLookController } from './input'
import { radPerPixel } from './sensitivity'
import { GameSession } from './session'
import type { ModeConfig } from '../modes/types'
import { AIM_TRAINER_ROOM } from '../modes/targetPlane'
import type { GameProfile } from '../store/profiles'
import type { BackgroundId } from '../store/appearance'

const DEFAULT_CAMERA_VERTICAL_FOV = 70.5328004329168

/**
 * 3D 场景引擎（M0 版）
 *
 * 职责：渲染器/场景/相机生命周期、环境搭建（暗色背景 + 网格地面 +
 * 霓虹装饰）、Pointer Lock 视角旋转、RAF 主循环。
 * 目标生成与射击逻辑属于后续里程碑，M0 仅提供可自由转动的空场景。
 */
export class Engine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private look: PointerLookController

  /** Frame timer replaces deprecated THREE.Clock; update() before getDelta(). */
  private timer = new THREE.Timer()
  private yaw = 0
  private pitch = 0
  private radPerPx = 0
  /** 复用的旋转 buffer，避免鼠标移动高频路径上的对象分配 */
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private session: GameSession | null = null
  private environmentResources: Array<{ dispose(): void }> = []
  private environmentObjects: THREE.Object3D[] = []
  private backgroundId: BackgroundId
  private targetColor: string

  /**
   * 应用游戏档案 + 游戏内灵敏度（由设置面板驱动）。
   * rotationExpr 可选：自定义「弧度 / 鼠标计数」公式；缺省用默认 Aim Lab 换算。
   */
  setSensitivity(
    profile: GameProfile,
    sensitivity: number,
    rotationExpr?: string,
  ): void {
    this.radPerPx = radPerPixel(profile, sensitivity, rotationExpr)
    this.camera.fov = profile.verticalFovDeg
    this.camera.updateProjectionMatrix()
  }

  setBackground(backgroundId: BackgroundId): void {
    if (this.backgroundId === backgroundId) return
    this.backgroundId = backgroundId
    this.disposeEnvironment()
    this.buildEnvironment()
  }

  setTargetColor(color: string): void {
    this.targetColor = color
    this.session?.setTargetColor(color)
  }

  set onLockChange(handler: ((locked: boolean) => void) | null) {
    this.look.onLockChange = handler
  }

  /** 锁定请求失败（浏览器 Pointer Lock 冷却期） */
  set onLockFail(handler: (() => void) | null) {
    this.look.onLockFail = handler
  }

  /**
   * createSession builds and attaches a round; pass kinematics for sens-finder trials.
   * Kinematics enable look-delta overshoot/reversal proxies used by calibration S_obj.
   */
  createSession(config: ModeConfig, options?: { kinematics?: boolean }): GameSession {
    this.resetView()
    const session = new GameSession(this.scene, this.camera, config, this.targetColor)
    if (options?.kinematics) session.setKinematicsEnabled(true)
    this.attach(session)
    return session
  }

  /** 挂接游戏会话：主循环驱动其 tick，射击输入转发给它 */
  attach(session: GameSession): void {
    this.session = session
    // 挂接时同步最新目标颜色：暂停期间改色（session 已 detach）也在恢复时生效
    session.setTargetColor(this.targetColor)
    this.look.onShoot = () => this.session?.shoot()
  }

  detach(): void {
    this.session = null
    this.look.onShoot = null
  }

  constructor(
    private container: HTMLElement,
    backgroundId: BackgroundId = 'classic',
    targetColor = '#f4f6ff',
  ) {
    this.backgroundId = backgroundId
    this.targetColor = targetColor
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0a0e1a)
    this.scene.fog = new THREE.Fog(0x0a0e1a, 40, 90)

    // Approximately 103 degrees horizontal at 16:9, matching the selected
    // Valorant profile and the supplied Aim Lab footage more closely.
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_VERTICAL_FOV,
      width / height,
      0.1,
      200,
    )
    this.camera.position.set(0, 1.6, 0)
    this.camera.rotation.order = 'YXZ'

    this.buildEnvironment()

    this.look = new PointerLookController(this.renderer.domElement, (dx, dy) => this.rotate(dx, dy))

    // Page Visibility API keeps dt near zero while the tab is hidden.
    this.timer.connect(document)
    window.addEventListener('resize', this.onResize)
    this.renderer.setAnimationLoop(this.tick)
  }

  /** 请求指针锁定（进入第一人称视角） */
  requestLock(): void {
    this.look.request()
  }

  /**
   * exitLock releases pointer lock for menus, comfort prompts, and other DOM UI.
   * Call before showing overlays that need a visible cursor and clicks.
   */
  exitLock(): void {
    this.look.exit()
  }

  /** 当前指针是否锁定 */
  get locked(): boolean {
    return document.pointerLockElement === this.renderer.domElement
  }

  private rotate(dxPixels: number, dyPixels: number): void {
    const dxRad = dxPixels * this.radPerPx
    this.yaw -= dxRad
    this.pitch -= dyPixels * this.radPerPx
    const limit = Math.PI / 2 - 0.01
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch))
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ')
    this.camera.quaternion.setFromEuler(this.euler)
    // Feed yaw delta to the active session for calibration kinematics proxies.
    this.session?.noteLookDelta(dxRad)
  }

  private resetView(): void {
    this.yaw = 0
    this.pitch = 0
    this.camera.quaternion.identity()
  }

  private buildEnvironment(): void {
    this.renderer.shadowMap.enabled = this.backgroundId === 'classic'
    switch (this.backgroundId) {
      case 'classic':
        this.buildClassicEnvironment()
        break
      case 'range':
        this.buildRangeEnvironment()
        break
      case 'white-room':
        this.buildWhiteStudioEnvironment()
        break
      case 'aurora':
        this.buildOrbitalEnvironment()
        break
      case 'foundry':
        this.buildFoundryEnvironment()
        break
    }
  }

  /** 搭建原有 Aim Lab 风格的封闭训练房间。 */
  private buildClassicEnvironment(): void {
    this.scene.background = new THREE.Color(0x0a0e1a)
    this.scene.fog = new THREE.Fog(0x0a0e1a, 40, 90)
    const { width, height, backZ, frontZ } = AIM_TRAINER_ROOM
    const depth = frontZ - backZ
    const centerZ = (frontZ + backZ) / 2
    const tileSize = 0.55
    this.addSkyDome()

    const wall = (geometry: THREE.PlaneGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.receiveShadow = true
      this.addEnvironmentObject(mesh)
      this.environmentResources.push(geometry)
      return mesh
    }

    const backMaterial = this.createCheckerMaterial(
      '#5d6267',
      '#555a5f',
      width / tileSize,
      height / tileSize,
    )
    const backWall = wall(
      new THREE.PlaneGeometry(width, height),
      backMaterial,
    )
    backWall.position.set(0, height / 2, backZ)

    const sideMaterialLeft = this.createCheckerMaterial(
      '#53585d',
      '#4b5055',
      depth / tileSize,
      height / tileSize,
    )
    const leftWall = wall(
      new THREE.PlaneGeometry(depth, height),
      sideMaterialLeft,
    )
    leftWall.position.set(-width / 2, height / 2, centerZ)
    leftWall.rotation.y = Math.PI / 2

    const sideMaterialRight = this.createCheckerMaterial(
      '#53585d',
      '#4b5055',
      depth / tileSize,
      height / tileSize,
    )
    const rightWall = wall(
      new THREE.PlaneGeometry(depth, height),
      sideMaterialRight,
    )
    rightWall.position.set(width / 2, height / 2, centerZ)
    rightWall.rotation.y = -Math.PI / 2

    const frontMaterial = this.createCheckerMaterial(
      '#53585d',
      '#4b5055',
      width / tileSize,
      height / tileSize,
    )
    const frontWall = wall(
      new THREE.PlaneGeometry(width, height),
      frontMaterial,
    )
    frontWall.position.set(0, height / 2, frontZ)
    frontWall.rotation.y = Math.PI

    const floorMaterial = this.createCheckerMaterial(
      '#aaa9a5',
      '#989a9c',
      width / tileSize,
      depth / tileSize,
    )
    const floor = wall(new THREE.PlaneGeometry(width, depth), floorMaterial)
    floor.position.set(0, 0, centerZ)
    floor.rotation.x = -Math.PI / 2

    const ceilingMaterial = this.createCheckerMaterial(
      '#676b6f',
      '#5f6367',
      12,
      12,
    )
    ceilingMaterial.emissive.set(0x30343a)
    ceilingMaterial.emissiveIntensity = 0.42

    const openingWidth = 14
    const openingBackZ = -3.6
    const openingFrontZ = -0.75
    const lightOpeningBackZ = -7.5
    const lightOpeningFrontZ = -4.65
    const sidePanelWidth = (width - openingWidth) / 2
    const ceilingThickness = 0.3
    const ceilingY = height - ceilingThickness / 2
    const addCeilingPanels = (
      openingBack: number,
      openingFront: number,
      panelY: number,
      thickness: number,
      material: THREE.Material,
      castShadow: boolean,
      receiveShadow: boolean,
    ) => {
      this.addRoomBox(
        new THREE.Vector3(sidePanelWidth, thickness, depth),
        new THREE.Vector3(
          -(openingWidth + sidePanelWidth) / 2,
          panelY,
          centerZ,
        ),
        material,
        castShadow,
        receiveShadow,
      )
      this.addRoomBox(
        new THREE.Vector3(sidePanelWidth, thickness, depth),
        new THREE.Vector3(
          (openingWidth + sidePanelWidth) / 2,
          panelY,
          centerZ,
        ),
        material,
        castShadow,
        receiveShadow,
      )
      const backPanelDepth = openingBack - backZ
      this.addRoomBox(
        new THREE.Vector3(openingWidth, thickness, backPanelDepth),
        new THREE.Vector3(0, panelY, backZ + backPanelDepth / 2),
        material,
        castShadow,
        receiveShadow,
      )
      const frontPanelDepth = frontZ - openingFront
      this.addRoomBox(
        new THREE.Vector3(openingWidth, thickness, frontPanelDepth),
        new THREE.Vector3(0, panelY, openingFront + frontPanelDepth / 2),
        material,
        castShadow,
        receiveShadow,
      )
    }

    // The visible skylight sits overhead, outside the normal aiming view.
    addCeilingPanels(
      openingBackZ,
      openingFrontZ,
      ceilingY,
      ceilingThickness,
      ceilingMaterial,
      false,
      true,
    )

    // An invisible canopy preserves the established light strip and target
    // shadows independently from the skylight's visible position.
    const shadowMaskMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
    })
    addCeilingPanels(
      lightOpeningBackZ,
      lightOpeningFrontZ,
      height + 0.12,
      0.08,
      shadowMaskMaterial,
      true,
      false,
    )
    this.environmentResources.push(shadowMaskMaterial)

    const stageMaterial = this.createCheckerMaterial(
      '#62676c',
      '#5a5f64',
      18,
      4,
    )
    this.addRoomBox(
      new THREE.Vector3(16, 1.35, 1.5),
      new THREE.Vector3(0, 0.675, -8.2),
      stageMaterial,
    )
    const ambient = new THREE.AmbientLight(0xcbd5e3, 0.9)
    this.addEnvironmentObject(ambient)
    const hemi = new THREE.HemisphereLight(0xd9efff, 0x70747b, 0.72)
    this.addEnvironmentObject(hemi)
    const dir = new THREE.DirectionalLight(0xfff3d8, 3.05)
    dir.position.set(0, 15, -6.65)
    dir.target.position.set(0, 0, -6.65)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.left = -10
    dir.shadow.camera.right = 10
    dir.shadow.camera.top = 9
    dir.shadow.camera.bottom = -9
    dir.shadow.camera.near = 0.5
    dir.shadow.camera.far = 24
    dir.shadow.bias = -0.0002
    dir.shadow.normalBias = 0.02
    dir.shadow.radius = 1.5
    this.addEnvironmentObject(dir.target)
    this.addEnvironmentObject(dir)
  }

  /** 参考图靶场：干净靶墙、开放暗场、细地网与单一红色十字基准。 */
  private buildRangeEnvironment(): void {
    this.setEnvironmentAtmosphere('#101820', 30, 72)
    const wall = this.createEnvironmentMaterial({ color: '#3b4047', roughness: 1 })
    const floor = this.createEnvironmentMaterial({ color: '#1d242b', roughness: 1 })
    this.addEnvironmentPlane(
      21,
      7.4,
      wall,
      new THREE.Vector3(0, 3.7, -8.8),
      new THREE.Euler(),
    )
    this.addEnvironmentPlane(
      42,
      42,
      floor,
      new THREE.Vector3(0, 0, -8),
      new THREE.Euler(-Math.PI / 2, 0, 0),
    )
    this.addEnvironmentGrid(42, 42, '#ff405c', '#344651', 0.5, new THREE.Vector3(0, 0.008, -8))
    this.addEnvironmentObject(new THREE.AmbientLight(0xb7c4cf, 1.35))
    this.addEnvironmentObject(new THREE.HemisphereLight(0xd2dde5, 0x202931, 0.75))
  }

  /** 无影白棚：无网格、无侧墙，以连续亮面和悬浮灯幕形成摄影棚空间。 */
  private buildWhiteStudioEnvironment(): void {
    this.setEnvironmentAtmosphere('#e8edef', 36, 90)
    const wall = this.createEnvironmentMaterial({ color: '#dfe5e7', roughness: 1 })
    const floor = this.createEnvironmentMaterial({ color: '#cbd3d6', roughness: 0.78 })
    const light = this.createEnvironmentMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveIntensity: 1.6,
      roughness: 0.3,
    })
    this.addEnvironmentPlane(
      28,
      12,
      wall,
      new THREE.Vector3(0, 5.2, -10),
      new THREE.Euler(),
    )
    this.addEnvironmentPlane(
      34,
      34,
      floor,
      new THREE.Vector3(0, 0, -7),
      new THREE.Euler(-Math.PI / 2, 0, 0),
    )
    for (const x of [-5.2, 5.2]) {
      this.addRoomBox(
        new THREE.Vector3(2.8, 0.08, 5.8),
        new THREE.Vector3(x, 6.3, -5.5),
        light,
        false,
        false,
      )
    }
    this.addEnvironmentObject(new THREE.AmbientLight(0xffffff, 2.15))
    this.addEnvironmentObject(new THREE.HemisphereLight(0xffffff, 0xaab5ba, 1.05))
  }

  /** 轨道极光：完全开放的星空，没有靶墙，以巨型光环定义训练区域。 */
  private buildOrbitalEnvironment(): void {
    this.setEnvironmentAtmosphere('#030d0c', 28, 80)
    const floor = this.createEnvironmentMaterial({
      color: '#071715',
      emissive: '#061210',
      emissiveIntensity: 0.45,
      roughness: 0.62,
      metalness: 0.22,
    })
    const glow = this.createEnvironmentMaterial({
      color: '#55e0cf',
      emissive: '#34cdbb',
      emissiveIntensity: 2.4,
      roughness: 0.25,
    })
    this.addEnvironmentPlane(
      36,
      36,
      floor,
      new THREE.Vector3(0, -0.02, -8),
      new THREE.Euler(-Math.PI / 2, 0, 0),
    )
    for (const [radius, opacity] of [[4.6, 1], [6.5, 0.5]] as const) {
      const geometry = new THREE.TorusGeometry(radius, 0.025 + opacity * 0.018, 8, 128)
      const ring = new THREE.Mesh(geometry, glow)
      ring.position.set(0, 2.25, -10.5 - radius * 0.12)
      ring.scale.y = 0.78
      this.environmentResources.push(geometry)
      this.addEnvironmentObject(ring)
    }
    this.addOrbitalStars()
    this.addEnvironmentObject(new THREE.AmbientLight(0x89c7bd, 1.05))
    this.addEnvironmentObject(new THREE.HemisphereLight(0x79eadb, 0x071310, 0.8))
  }

  /** 工业廊桥：开放深层通道、重复钢梁门架与分段跑道。 */
  private buildFoundryEnvironment(): void {
    this.setEnvironmentAtmosphere('#101214', 18, 54)
    const steel = this.createEnvironmentMaterial({ color: '#34393b', roughness: 0.74, metalness: 0.45 })
    const floor = this.createEnvironmentMaterial({ color: '#24282a', roughness: 0.88, metalness: 0.18 })
    const marker = this.createEnvironmentMaterial({
      color: '#d8b94c',
      emissive: '#9f7d18',
      emissiveIntensity: 1.1,
      roughness: 0.5,
    })
    this.addEnvironmentPlane(
      22,
      44,
      floor,
      new THREE.Vector3(0, 0, -10),
      new THREE.Euler(-Math.PI / 2, 0, 0),
    )
    for (const z of [-8.6, -12.6, -16.6, -20.6]) {
      this.addRoomBox(new THREE.Vector3(0.34, 6.4, 0.34), new THREE.Vector3(-6.1, 3.2, z), steel, false, false)
      this.addRoomBox(new THREE.Vector3(0.34, 6.4, 0.34), new THREE.Vector3(6.1, 3.2, z), steel, false, false)
      this.addRoomBox(new THREE.Vector3(12.5, 0.34, 0.34), new THREE.Vector3(0, 6.2, z), steel, false, false)
    }
    for (const x of [-4.7, 4.7]) {
      this.addRoomBox(new THREE.Vector3(0.08, 0.025, 34), new THREE.Vector3(x, 0.025, -10), marker, false, false)
    }
    this.addRoomBox(new THREE.Vector3(5.2, 0.055, 0.22), new THREE.Vector3(0, 5.82, -8.7), marker, false, false)
    this.addEnvironmentObject(new THREE.AmbientLight(0xb8b6ad, 1.05))
    const topLight = new THREE.PointLight(0xffe8ac, 18, 26, 1.8)
    topLight.position.set(0, 6.1, -7)
    this.addEnvironmentObject(topLight)
  }

  private addSkyDome(): void {
    const canvas = document.createElement('canvas')
    canvas.width = 2048
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')

    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
    sky.addColorStop(0, '#3c95d5')
    sky.addColorStop(0.48, '#73bee8')
    sky.addColorStop(1, '#d5eef9')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const sun = ctx.createRadialGradient(1560, 390, 0, 1560, 390, 170)
    sun.addColorStop(0, 'rgba(255, 253, 222, 0.7)')
    sun.addColorStop(0.2, 'rgba(255, 250, 213, 0.38)')
    sun.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = sun
    ctx.fillRect(1390, 220, 340, 340)

    let seed = 74123
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    // Clouds are concentrated around the texture's middle band. The dome is
    // rotated below so that this distortion-free band sits over the skylight.
    for (let i = 0; i < 10; i++) {
      const x = 90 + random() * (canvas.width - 180)
      const y = 300 + random() * 430
      const scale = 0.6 + random() * 0.8
      const opacity = 0.34 + random() * 0.16
      const puffs = 4 + Math.floor(random() * 3)
      for (let p = 0; p < puffs; p++) {
        const px = x + (random() - 0.5) * 210 * scale
        const py = y + (random() - 0.5) * 48 * scale
        const radius = (48 + random() * 58) * scale
        const cloud = ctx.createRadialGradient(px, py, 0, px, py, radius)
        cloud.addColorStop(0, `rgba(255, 255, 255, ${opacity})`)
        cloud.addColorStop(0.52, `rgba(250, 253, 255, ${opacity * 0.8})`)
        cloud.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = cloud
        ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2)
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    const geometry = new THREE.SphereGeometry(70, 48, 24)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    const skyDome = new THREE.Mesh(geometry, material)
    skyDome.rotation.x = Math.PI / 2
    skyDome.renderOrder = -1
    this.addEnvironmentObject(skyDome)
    this.environmentResources.push(texture, geometry, material)
  }

  private createCheckerMaterial(
    light: string,
    dark: string,
    repeatX: number,
    repeatY: number,
  ): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')

    ctx.fillStyle = light
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = dark
    ctx.fillRect(64, 0, 64, 64)
    ctx.fillRect(0, 64, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(repeatX / 2, repeatY / 2)
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.92,
      metalness: 0,
    })
    this.environmentResources.push(texture, material)
    return material
  }

  private setEnvironmentAtmosphere(color: string, fogNear: number, fogFar: number): void {
    this.scene.background = new THREE.Color(color)
    this.scene.fog = new THREE.Fog(color, fogNear, fogFar)
  }

  private createEnvironmentMaterial(
    parameters: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(parameters)
    this.environmentResources.push(material)
    return material
  }

  private addEnvironmentPlane(
    width: number,
    height: number,
    material: THREE.Material,
    position: THREE.Vector3,
    rotation: THREE.Euler,
  ): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(width, height)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    mesh.rotation.copy(rotation)
    this.environmentResources.push(geometry)
    return this.addEnvironmentObject(mesh)
  }

  private addEnvironmentGrid(
    size: number,
    divisions: number,
    centerColor: string,
    gridColor: string,
    opacity: number,
    position: THREE.Vector3,
  ): void {
    const grid = new THREE.GridHelper(size, divisions, centerColor, gridColor)
    grid.position.copy(position)
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
    for (const material of materials) {
      material.transparent = true
      material.opacity = opacity
      this.environmentResources.push(material)
    }
    this.environmentResources.push(grid.geometry)
    this.addEnvironmentObject(grid)
  }

  private addOrbitalStars(): void {
    const count = 260
    const positions = new Float32Array(count * 3)
    let seed = 9127
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let index = 0; index < count; index++) {
      positions[index * 3] = (random() - 0.5) * 42
      positions[index * 3 + 1] = random() * 18 - 1
      positions[index * 3 + 2] = -8 - random() * 38
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: '#9be9de',
      size: 0.055,
      transparent: true,
      opacity: 0.72,
      sizeAttenuation: true,
      fog: true,
    })
    this.environmentResources.push(geometry, material)
    this.addEnvironmentObject(new THREE.Points(geometry, material))
  }

  private addRoomBox(
    size: THREE.Vector3,
    position: THREE.Vector3,
    material: THREE.Material,
    castShadow = true,
    receiveShadow = true,
  ): void {
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    mesh.castShadow = castShadow
    mesh.receiveShadow = receiveShadow
    this.addEnvironmentObject(mesh)
    this.environmentResources.push(geometry)
  }

  private addEnvironmentObject<T extends THREE.Object3D>(object: T): T {
    this.scene.add(object)
    this.environmentObjects.push(object)
    return object
  }

  private disposeEnvironment(): void {
    for (const object of this.environmentObjects) this.scene.remove(object)
    this.environmentObjects = []
    for (const resource of this.environmentResources) resource.dispose()
    this.environmentResources = []
  }

  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private tick = (timestamp?: number): void => {
    this.timer.update(timestamp)
    const dt = this.timer.getDelta()
    this.look.flush()
    this.session?.tick(dt)
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.timer.dispose()
    this.look.dispose()
    this.disposeEnvironment()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
