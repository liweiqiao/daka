-- ============================================================
-- 清城少年志 · 国庆打卡工具 —— 数据库结构
-- MySQL 8 / InnoDB / utf8mb4
-- 执行方式：node db/init.js  （或直接 source 本文件）
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1. 参与者：信息只登记一次，之后每天打卡靠 token 识别
--    重名处理：唯一标识用 id，手机号是业务身份；
--    uk_phone_name 让「同名」靠手机号区分，也允许一个手机号登记两个孩子
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_participant` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone`      CHAR(11)        NOT NULL                COMMENT '家长手机号，兼作领奖/证书发放凭证',
  `name`       VARCHAR(32)     NOT NULL                COMMENT '学生姓名',
  `school`     VARCHAR(128)    NOT NULL                COMMENT '学校全称+班级',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_phone_name` (`phone`, `name`),
  KEY `idx_phone` (`phone`),
  KEY `idx_school` (`school`),
  KEY `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='参与者（唯一标识=id；姓名重名靠手机号区分）';

-- ------------------------------------------------------------
-- 2. 任务字典：7 天 × 7 主题 = 49 项
--    (day_date, theme) 唯一 → 一天一个主题只有一项任务
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_task` (
  `id`            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `day_date`      DATE              NOT NULL,
  `day_no`        TINYINT UNSIGNED  NOT NULL DEFAULT 1,
  `weekday`       VARCHAR(4)        NOT NULL DEFAULT '',
  `theme`         VARCHAR(8)        NOT NULL COMMENT '专注/乐观/希望/自信/感恩/坚韧/活力',
  `task_name`     VARCHAR(64)       NOT NULL,
  `task_desc`     VARCHAR(255)      NOT NULL DEFAULT '',
  `task_how`      VARCHAR(255)      NOT NULL DEFAULT '' COMMENT '打卡要求：怎么拍',
  `is_offline`    TINYINT(1)        NOT NULL DEFAULT 0  COMMENT '1=线下打卡点任务（10/2-10/6）',
  `offline_point` VARCHAR(32)       NOT NULL DEFAULT '' COMMENT '线下打卡点名称',
  `sort_no`       TINYINT UNSIGNED  NOT NULL DEFAULT 0  COMMENT '主题排序 0-6',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_day_theme` (`day_date`, `theme`),
  KEY `idx_theme` (`theme`),
  KEY `idx_day` (`day_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='任务字典（唯一真源，前端渲染 + 统计反查）';

-- ------------------------------------------------------------
-- 3. 提交批次：一次表单提交一行
--    uk_request 让微信自动重发变成幂等，不产生重复数据
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_batch` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `request_id`     CHAR(36)         NOT NULL COMMENT '前端 UUID，幂等键',
  `participant_id` BIGINT UNSIGNED  NOT NULL,
  `checkin_date`   DATE             NOT NULL COMMENT '北京日期，服务端决定',
  `item_count`     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `photo_count`    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `video_count`    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `remark`         VARCHAR(500)     DEFAULT NULL COMMENT '本次提交的补充说明',
  `client_ip`      VARCHAR(45)      DEFAULT NULL,
  `ua`             VARCHAR(255)     DEFAULT NULL,
  `created_at`     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_request` (`request_id`),
  KEY `idx_p_date` (`participant_id`, `checkin_date`),
  KEY `idx_date` (`checkin_date`),
  CONSTRAINT `fk_batch_p` FOREIGN KEY (`participant_id`)
    REFERENCES `daka_participant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='提交批次（一次表单提交=一行）';

-- ------------------------------------------------------------
-- 4. 打卡明细：★ 统计口径的唯一真源
--    累计打卡次数 = COUNT(*)（每完成 1 项算 1 次）
--    uk_once(participant_id, task_id) 从数据库层面物理拦住
--    「同一人重复做同一个任务」——不依赖应用层判断
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_checkin` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `batch_id`       BIGINT UNSIGNED  NOT NULL,
  `participant_id` BIGINT UNSIGNED  NOT NULL,
  `checkin_date`   DATE             NOT NULL COMMENT '北京日期，服务端决定',
  `task_id`        SMALLINT UNSIGNED NOT NULL,
  `theme`          VARCHAR(8)       NOT NULL COMMENT '冗余快照，防字典改动',
  `task_name`      VARCHAR(64)      NOT NULL COMMENT '冗余快照，防字典改动',
  `is_offline`     TINYINT(1)       NOT NULL DEFAULT 0,
  `remark`         VARCHAR(500)     DEFAULT NULL COMMENT '这一项的文字说明/感受（选填）',
  `created_at`     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_once` (`participant_id`, `task_id`),
  KEY `idx_date_theme` (`checkin_date`, `theme`),
  KEY `idx_p_date` (`participant_id`, `checkin_date`),
  KEY `idx_theme` (`theme`),
  KEY `idx_batch` (`batch_id`),
  KEY `idx_task` (`task_id`),
  CONSTRAINT `fk_ck_batch` FOREIGN KEY (`batch_id`)
    REFERENCES `daka_batch` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ck_p` FOREIGN KEY (`participant_id`)
    REFERENCES `daka_participant` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ck_task` FOREIGN KEY (`task_id`)
    REFERENCES `daka_task` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='打卡明细（一次打卡=一行；累计次数=COUNT(*)）';

-- ------------------------------------------------------------
-- 5. 媒体台账：上传前先落库
--    好处：孤儿文件（传成功但表单没提交）可精确枚举，不靠时间戳猜
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_media` (
  `id`             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `participant_id` BIGINT UNSIGNED  NOT NULL,
  `batch_id`       BIGINT UNSIGNED  DEFAULT NULL COMMENT 'NULL=已上传未绑定',
  `task_id`        SMALLINT UNSIGNED DEFAULT NULL COMMENT '属于哪一项任务；上传时前端可先声明，提交时服务端覆写为权威值',
  `media_type`     ENUM('image','video') NOT NULL,
  `storage`        ENUM('local','qiniu') NOT NULL DEFAULT 'local',
  `object_key`     VARCHAR(255)     NOT NULL COMMENT '存储路径/七牛 key',
  `file_name`      VARCHAR(255)     DEFAULT NULL COMMENT '原始文件名',
  `file_size`      INT UNSIGNED     NOT NULL DEFAULT 0,
  `mime`           VARCHAR(64)      DEFAULT NULL,
  `width`          SMALLINT UNSIGNED DEFAULT NULL,
  `height`         SMALLINT UNSIGNED DEFAULT NULL,
  `duration`       SMALLINT UNSIGNED DEFAULT NULL COMMENT '视频秒数',
  `qiniu_hash`     VARCHAR(64)      DEFAULT NULL,
  `status`         TINYINT          NOT NULL DEFAULT 0 COMMENT '0=待绑定 1=已绑定 -1=已清理',
  `sort_no`        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key` (`object_key`),
  KEY `idx_batch` (`batch_id`),
  KEY `idx_media_task` (`task_id`),
  KEY `idx_gc` (`status`, `created_at`),
  KEY `idx_p` (`participant_id`),
  CONSTRAINT `fk_media_p` FOREIGN KEY (`participant_id`)
    REFERENCES `daka_participant` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_media_b` FOREIGN KEY (`batch_id`)
    REFERENCES `daka_batch` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_media_t` FOREIGN KEY (`task_id`)
    REFERENCES `daka_task` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ROW_FORMAT=DYNAMIC
  COMMENT='凭证文件台账（图片/视频）';

-- ------------------------------------------------------------
-- 6. 活动配置（键值对，后台可改）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_config` (
  `k`          VARCHAR(64) NOT NULL,
  `v`          TEXT        NOT NULL,
  `label`      VARCHAR(64) NOT NULL DEFAULT '',
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='活动配置';

-- ------------------------------------------------------------
-- 7. 后台管理员
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_admin` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(32)  NOT NULL,
  `password_hash` VARCHAR(100) NOT NULL,
  `display_name`  VARCHAR(32)  NOT NULL DEFAULT '',
  `last_login_at` DATETIME     DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='后台管理员';

-- ------------------------------------------------------------
-- 8. 后台操作日志（删记录、改配置留痕）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daka_oplog` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   INT UNSIGNED    DEFAULT NULL,
  `admin_name` VARCHAR(32)     NOT NULL DEFAULT '',
  `action`     VARCHAR(32)     NOT NULL,
  `target`     VARCHAR(64)     NOT NULL DEFAULT '',
  `detail`     VARCHAR(500)    NOT NULL DEFAULT '',
  `ip`         VARCHAR(45)     NOT NULL DEFAULT '',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='后台操作日志';
