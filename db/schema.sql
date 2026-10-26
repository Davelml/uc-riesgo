-- uc-riesgo · esquema propuesto (MySQL 8). Ajustar tipos si el Backoffice usa otro motor.

-- Parámetros vigentes y su historial. Solo ADMIN/Riesgo insertan filas; nunca se edita una fila existente.
CREATE TABLE riesgo_parametros (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  vigente_desde   DATETIME      NOT NULL,
  B               DECIMAL(14,2) NOT NULL,
  p               DECIMAL(5,4)  NOT NULL,
  lambda_nr       DECIMAL(5,4)  NOT NULL,
  alpha           DECIMAL(5,4)  NOT NULL,
  beta            DECIMAL(5,4)  NOT NULL,
  tope_grupo      DECIMAL(5,4)  NOT NULL,
  tope_depto      DECIMAL(5,4)  NOT NULL,
  max_op_pct      DECIMAL(6,5)  NOT NULL,
  min_op_pct      DECIMAL(6,5)  NOT NULL,
  aprobado_por    VARCHAR(64)   NOT NULL,
  motivo          VARCHAR(255)  NULL,
  creado_en       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Máximo del P&L reconocido por mes (H). Nunca baja dentro del mes.
CREATE TABLE riesgo_maximo_mes (
  periodo         CHAR(7)       NOT NULL,          -- '2026-10'
  ambito          VARCHAR(32)   NOT NULL,          -- 'EQUIPO' o id del trader
  h_maximo        DECIMAL(14,2) NOT NULL DEFAULT 0,
  actualizado_en  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (periodo, ambito)
);
-- Actualización: INSERT ... ON DUPLICATE KEY UPDATE h_maximo = GREATEST(h_maximo, VALUES(h_maximo));

-- Stop y datos de riesgo de cada posición u orden leída desde cTrader.
CREATE TABLE riesgo_posiciones (
  posicion_id     VARCHAR(64)   PRIMARY KEY,       -- id de cTrader
  trader_id       VARCHAR(32)   NOT NULL,
  cuenta          VARCHAR(64)   NOT NULL,
  instrumento     VARCHAR(32)   NOT NULL,
  direccion       ENUM('Largo','Corto') NOT NULL,
  cantidad        DECIMAL(18,6) NOT NULL,
  multiplicador   DECIMAL(18,6) NOT NULL DEFAULT 1,
  precio_entrada  DECIMAL(18,6) NOT NULL,
  stop            DECIMAL(18,6) NULL,              -- NULL = sin stop (incumplimiento)
  pendiente       TINYINT(1)    NOT NULL DEFAULT 0,
  estado          ENUM('ABIERTA','PENDIENTE','CERRADA','CANCELADA') NOT NULL,
  abierta_en      DATETIME      NOT NULL,
  cerrada_en      DATETIME      NULL,
  INDEX (trader_id, estado)
);

-- Grupo de correlación de cada instrumento. Un instrumento sin fila no se puede operar.
CREATE TABLE riesgo_instrumentos (
  instrumento     VARCHAR(32)   PRIMARY KEY,
  grupo           VARCHAR(32)   NOT NULL,          -- Metales, Energía, Cripto, Divisas
  deslizamiento   DECIMAL(18,6) NOT NULL DEFAULT 0, -- unidades de precio (propuesta: 0,25 x ATR diario)
  multiplicador   DECIMAL(18,6) NOT NULL DEFAULT 1
);
INSERT INTO riesgo_instrumentos (instrumento, grupo) VALUES
  ('XAUUSD','Metales'),('XAGUSD','Metales'),('SPOTBRENT','Energía'),('NATGAS','Energía'),
  ('BTC','Cripto'),('ETH','Cripto'),('XRP','Cripto'),('SOL','Cripto'),('BNB','Cripto'),('LINK','Cripto');

-- Incumplimientos y excepciones. Alimentan el informe diario y el pilar Disciplina del Score UC.
CREATE TABLE riesgo_incumplimientos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  ocurrido_en     DATETIME      NOT NULL,
  trader_id       VARCHAR(32)   NULL,
  tipo            VARCHAR(32)   NOT NULL,          -- SIN_STOP, TOPE_TRADER, TOPE_GRUPO, TOPE_DEPARTAMENTO, TOPE_EQUIPO, ...
  detalle         VARCHAR(255)  NOT NULL,
  exceso          DECIMAL(14,2) NULL,
  estado_equipo   VARCHAR(16)   NOT NULL,
  accion          VARCHAR(255)  NULL,
  excepcion_aprobada_por VARCHAR(64) NULL,
  excepcion_vence DATETIME      NULL,
  INDEX (trader_id, ocurrido_en)
);
