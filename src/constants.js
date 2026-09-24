/**
 * constants.js —— 全局物理与游戏常量
 *
 * 所有数值均来自原版游戏调参，修改时请同步更新对应单元测试。
 */

// ─── 物理常量 ───────────────────────────────────────────────
/** 线条半径（碰撞厚度），单位：世界像素 */
export const T = 4;

/** 重力加速度（向下为正） */
export const G = 1400;

/** 关节马达扭矩系数：扭矩 = POWER × 自重 × 半径 */
export const POWER = 2.5;

/** 关节最大角速度（弧度/秒） */
export const WMAX = 12;

/** 碰撞弹性系数（0 = 完全非弹性，1 = 完全弹性） */
export const E = 0.1;

/** 地面摩擦系数 */
export const MU = 0.9;

// ─── 水 / 泥常量 ─────────────────────────────────────────────
/** 水的浮力比（相对重力；>1 代表浮力大于重力，可游泳） */
export const BUOY = 1.8;

/** 水的阻力系数（1/s） */
export const DRAG = 4;

/** 泥浆浮力比（<1 代表会下沉） */
export const MUD_BUOY = 0.6;

/** 泥浆阻力系数 */
export const MUD_DRAG = 9;

// ─── 地形常量 ─────────────────────────────────────────────────
/** 阶梯单级高度（像素） */
export const STEP_H = 40;

/** 隧道净高（地面到天花板距离） */
export const TUNNEL_H = 74;

/** 地形采样间距（每 TSTEP 像素一个点） */
export const TSTEP = 2;

// ─── 坐标 / 视图常量 ──────────────────────────────────────────
/** 画板坐标 → 世界坐标的缩放比例 */
export const SCALE = 0.56;

/** 屏幕显示的世界宽度（世界像素） */
export const VIEW_W = 520;

/** 玩家出发点 X 坐标 */
export const START_X = 120;

// ─── 模拟常量 ─────────────────────────────────────────────────
/** 物理步长（秒），固定步长保证跨帧一致性 */
export const DT = 1 / 240;

/** 每帧最大累计模拟时间，防止卡顿时步长爆炸 */
export const MAX_ACCUM = 0.05;

// ─── CPU 常量 ─────────────────────────────────────────────────
/** CPU 角速度上限倍率（相对玩家；越小越"慢"） */
export const CPU_SPEED = 0.55;

/** CPU 切换姿势前的反应延迟（秒） */
export const CPU_DELAY = 3.0;

// ─── 人体模板与绘制限制常量（画板坐标系，300×180 画布，人物面朝右） ─────
/** 头部：圆心坐标 + 半径 */
export const HEAD     = { x: 150, y: 40,  r: 14 };

/** 肩关节坐标（手臂起点） */
export const SHOULDER = { x: 150, y: 62 };

/** 髋关节坐标（腿部起点） */
export const HIP      = { x: 150, y: 110 };

/** 躯干折线（从肩到髋，含中间点） */
export const TORSO    = [{ x: 150, y: 54 }, SHOULDER, HIP];

/** 每个关节最多保留的笔划数（超出则移除最早的） */
export const MAX_PER_JOINT = 1;

/** 物理质点质量基准（每个采样点的质量） */
export const M_PT = 100;

// ─── 绘制尺寸限制（防止超大圆与超长直线破坏游戏平衡） ───────────
/** 正圆最大半径（画板像素，防止超大轮子导致巨大线速度和跨图） */
export const MAX_CIRCLE_RADIUS = 55;

/** 正圆最小半径（画板像素） */
export const MIN_CIRCLE_RADIUS = 6;

/** 肢体笔划相对关节的最大跨度半径（画板像素，防止超长直线/巨型杠杆飞天开挂） */
export const MAX_LIMB_RADIUS = 80;


