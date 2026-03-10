import os
import time
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from polygon import RESTClient
from dotenv import load_dotenv

# ==============================
# LOAD ENV
# ==============================

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
API_KEY = os.getenv("API_KEY")

if not DATABASE_URL:
    raise Exception("DATABASE_URL missing in .env")

if not API_KEY:
    raise Exception("API_KEY missing in .env")

client = RESTClient(API_KEY)

# ==============================
# DB CONNECTION
# ==============================

con = psycopg2.connect(DATABASE_URL)
con.autocommit = True
cur = con.cursor()

print("Connected to PostgreSQL", flush=True)

# ==============================
# CREATE TABLES
# ==============================

cur.execute("""
CREATE TABLE IF NOT EXISTS "EnginePriceStat" (
    id SERIAL PRIMARY KEY,
    ticker TEXT,
    price DOUBLE PRECISION,
    "dayOpen" DOUBLE PRECISION,
    "prevClose" DOUBLE PRECISION,
    "changePercent" DOUBLE PRECISION,
    session TEXT,
    "cbDate" TEXT,
    cbucket INTEGER,
    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
""")

cur.execute('CREATE INDEX IF NOT EXISTS "EnginePriceStat_ticker_cbucket" ON "EnginePriceStat" ("ticker", "cbucket" DESC);')
cur.execute('CREATE INDEX IF NOT EXISTS "EnginePriceStat_ts" ON "EnginePriceStat" ("ts" DESC);')

cur.execute("""
CREATE TABLE IF NOT EXISTS "MarketMover" (
    id SERIAL PRIMARY KEY,
    type TEXT,
    ticker TEXT,
    price DOUBLE PRECISION,
    "changePercent" DOUBLE PRECISION,
    session TEXT,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "commonFlag" INTEGER DEFAULT 0,
    "dayOpen" DOUBLE PRECISION,
    "prevClose" DOUBLE PRECISION
);
""")

print("Tables verified")

# ==============================
# LOAD WATCHLIST
# ==============================

def load_watchlist():
    tickers = set()
    # 1. From CSV (Legacy)
    try:
        if os.path.exists("Watchlist_New.csv"):
            df = pd.read_csv("Watchlist_New.csv")
            csv_tickers = df["Ticker"].dropna().str.upper().unique().tolist()
            tickers.update(csv_tickers)
    except Exception as e:
        print("CSV load error:", e)

    # 2. From DB (Primary)
    try:
        cur.execute('SELECT ticker FROM "Watchlist"')
        db_rows = cur.fetchall()
        tickers.update([r[0].upper() for r in db_rows])
    except Exception as e:
        print("DB Watchlist load error:", e)
        
    return list(tickers)

def get_common_tickers():
    try:
        cur.execute('SELECT ticker FROM "Watchlist" WHERE category = \'Common\'')
        return [r[0].upper() for r in cur.fetchall()]
    except:
        return []

# ==============================
# SESSION DETECTOR
# ==============================

def get_session():
    ny = datetime.now(ZoneInfo("America/New_York"))

    if 9 <= ny.hour < 16:
        return "Regular"
    elif 4 <= ny.hour < 9:
        return "Pre-Market"
    elif 16 <= ny.hour < 20:
        return "Post-Market"
    return "Closed"

# ==============================
# SNAPSHOT FETCH + INSERT
# ==============================

def fetch_and_store(stocks):
    session = get_session()
    now = datetime.now(ZoneInfo("UTC"))
    cbucket = now.hour * 60 + now.minute
    cb_date = date.today().strftime("%b-%d-%Y")

    snapshots = client.get_snapshot_all("stocks", stocks)

    rows = []

    for s in snapshots:
        if not s.last_trade:
            continue

        price = s.last_trade.price or 0
        day_open = s.day.open if s.day else price
        prev_close = s.prev_day.close if s.prev_day else price

        change_pct = 0
        if prev_close:
            change_pct = ((price - prev_close) / prev_close) * 100

        rows.append((
            cb_date,
            cbucket,
            session,
            s.ticker,
            price,
            day_open,
            prev_close,
            change_pct,
            now
        ))

    if rows:
        execute_values(
            cur,
            """
            INSERT INTO "EnginePriceStat"
            (ticker, price, "dayOpen", "prevClose", "changePercent", session, "cbDate", cbucket, ts)
            VALUES %s
            """,
            [(r[3], r[4], r[5], r[6], r[7], r[2], r[0], r[1], r[8]) for r in rows]
        )

        print(f"Inserted {len(rows)} snapshots for {len(stocks)} tickers")

# ==============================
# ROLLING CLEANUP (3 HOURS)
# ==============================

def rolling_cleanup():
    cutoff = datetime.now(ZoneInfo("UTC")) - timedelta(hours=3)
    cur.execute('DELETE FROM "EnginePriceStat" WHERE ts < %s', (cutoff,))
    print("Cleanup complete", flush=True)

# ==============================
# MOMENTUM ENGINE
# ==============================

def calculate_momentum():
    print("Calculating momentum for all tickers...", flush=True)
    start_time = time.time()
    now = datetime.now(ZoneInfo("UTC"))

    # 1. Fetch all unique tickers and their latest stats
    cur.execute("""
        SELECT ticker, price, cbucket, "dayOpen", "prevClose"
        FROM (
            SELECT ticker, price, cbucket, "dayOpen", "prevClose",
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ts DESC) as rn
            FROM "EnginePriceStat"
        ) t
        WHERE rn = 1
    """)
    latest_stats = cur.fetchall()

    if not latest_stats:
        print("No data found in EnginePriceStat yet.")
        return

    # 2. Fetch all historical data for the last 40 minutes to do in-memory lookups
    print(f"Fetching historical data for {len(latest_stats)} tickers...", flush=True)
    window_start = now - timedelta(minutes=45)
    cur.execute("""
        SELECT ticker, price, cbucket
        FROM "EnginePriceStat"
        WHERE ts > %s
        ORDER BY ticker, cbucket DESC
    """, (window_start,))
    history_rows = cur.fetchall()
    print(f"Retrieved {len(history_rows)} historical rows.", flush=True)
    
    # Organize history by ticker
    history = {}
    for t_ticker, t_price, t_bucket in history_rows:
        if t_ticker not in history:
            history[t_ticker] = []
        history[t_ticker].append((t_bucket, t_price))

    movers = []

    for ticker, price, cbucket, day_open, prev_close in latest_stats:
        ticker_history = history.get(ticker, [])

        def find_price_at_bucket(target_bucket):
            # Find the closest bucket <= target_bucket
            for h_bucket, h_price in ticker_history:
                if h_bucket <= target_bucket:
                    return h_price
            return None

        p1 = find_price_at_bucket(cbucket - 1)
        p5 = find_price_at_bucket(cbucket - 5)
        p30 = find_price_at_bucket(cbucket - 30)

        def pct(old, new):
            if not old or old == 0:
                return 0
            return ((new - old) / old) * 100

        one_min = pct(p1, price)
        five_min = pct(p5, price)
        thirty_min = pct(p30, price)
        day_change = pct(prev_close, price)

        # Thresholds
        if day_change > 1.0:
            movers.append(("day_ripper", ticker, price, day_change, day_open, prev_close))
        elif day_change < -1.0:
            movers.append(("day_dipper", ticker, price, day_change, day_open, prev_close))
        
        if one_min > 0.4:
            movers.append(("1m_ripper", ticker, price, one_min, day_open, prev_close))
        elif one_min < -0.4:
            movers.append(("1m_dipper", ticker, price, one_min, day_open, prev_close))

        if five_min > 0.8:
            movers.append(("5m_ripper", ticker, price, five_min, day_open, prev_close))
        elif five_min < -0.8:
            movers.append(("5m_dipper", ticker, price, five_min, day_open, prev_close))

        if thirty_min > 1.5:
            movers.append(("30m_ripper", ticker, price, thirty_min, day_open, prev_close))
        elif thirty_min < -1.5:
            movers.append(("30m_dipper", ticker, price, thirty_min, day_open, prev_close))
            
    # Clear old movers
    cur.execute('DELETE FROM "MarketMover"')

    common_tickers = get_common_tickers()

    if not movers:
        print("Scanned tickers, but no movers met the momentum thresholds yet.")
    else:
        for mtype, ticker, price, change, op, pc in movers:
            is_common = 1 if ticker.upper() in common_tickers else 0
            cur.execute("""
                INSERT INTO "MarketMover"
                (type, ticker, price, "changePercent", session, "updatedAt", "commonFlag", "dayOpen", "prevClose")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                mtype,
                ticker,
                price,
                change,
                get_session(),
                now,
                is_common,
                op,
                pc
            ))
        print(f"Momentum calculation complete. Inserted {len(movers)} movers in {time.time() - start_time:.2f}s")

# ==============================
# MAIN LOOP
# ==============================

print("Engine Started")

while True:
    try:
        print(f"Cycle Start: {datetime.now().strftime('%H:%M:%S')}", flush=True)
        stocks = load_watchlist()

        if not stocks:
            print("No stocks found in Watchlist_New.csv or Database", flush=True)
            time.sleep(30)
            continue

        print(f"Fetching snapshots for {len(stocks)} tickers...", flush=True)
        fetch_and_store(stocks)
        rolling_cleanup()
        calculate_momentum()

        print("Cycle complete. Sleeping 30s...\n", flush=True)
        time.sleep(30)

    except Exception as e:
        print("Engine Error:", e, flush=True)
        time.sleep(10)
