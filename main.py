from fastapi import FastAPI, Depends, HTTPException, status, Request, UploadFile, File, Response
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from fastapi.responses import StreamingResponse
from fpdf import FPDF
import pandas as pd
import io
import bcrypt
from datetime import datetime, timedelta
from typing import List, Optional
from jose import JWTError, jwt
import models, schemas, database
import uvicorn
import os
import shutil
import json

models.Base.metadata.create_all(bind=database.engine)

from sqlalchemy import text
def apply_migrations():
    db = database.SessionLocal()
    try:
        # Check if is_live_sale exists - PostgreSQL (Supabase) version
        engine_url = str(database.engine.url)
        if "postgresql" in engine_url:
            db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_live_sale BOOLEAN DEFAULT FALSE"))
            db.commit()
            print("PostgreSQL migration: is_live_sale added if not exists.")
        else:
            # SQLite version (local)
            try:
                db.execute(text("ALTER TABLE orders ADD COLUMN is_live_sale BOOLEAN DEFAULT FALSE"))
                db.commit()
                print("SQLite migration: is_live_sale added.")
            except Exception:
                db.rollback()
                # print("SQLite migration: is_live_sale likely already exists.")
    except Exception as e:
        print(f"Migration error: {e}")
        db.rollback()
    finally:
        db.close()

apply_migrations()

app = FastAPI()

# v2.0 - Estado de órdenes con bifurcación de pago
VALID_TRANSITIONS = {
    "Recibido": ["En Preparación", "Cancelado"],
    "En Preparación": ["Preparado", "Cancelado"],
    "Preparado": ["Despachado", "Cancelado"],
    "Despachado": ["Pagado", "Por Pagar", "Cancelado"],
    "Pagado": ["Finalizado", "Cancelado"],
    "Por Pagar": ["Pagado", "Cancelado"],
    "Finalizado": ["Cancelado"],
    "Cancelado": []
}

def validate_status_transition(current_status: str, new_status: str) -> bool:
    """Valida si la transición de estado es permitida en v2.0"""
    if current_status not in VALID_TRANSITIONS:
        return True  # Si el estado no existe en el mapa, permitir (compatibilidad)
    return new_status in VALID_TRANSITIONS[current_status]

# Estados cuyo dinero ya entró y por lo tanto cuentan en el Cierre bancario
BANK_CLOSE_STATUSES = ("Pagado", "Finalizado")

def apply_status_flags(order, status: str):
    """Mantiene include_in_close / contabilizado coherentes con el estado (v2.0).
    Si el pedido ya fue incluido en un Cierre bancario (close_period con valor),
    no se vuelve a marcar para evitar contarlo dos veces."""
    already_closed = bool(order.close_period)
    if status == "Por Pagar":
        order.include_in_close = True
        order.contabilizado = False
    elif status == "Pagado":
        order.include_in_close = not already_closed
        order.contabilizado = False
    elif status == "Finalizado":
        order.include_in_close = not already_closed
        order.contabilizado = True
    else:  # Recibido, En Preparación, Preparado, Despachado, Cancelado
        order.include_in_close = False
        order.contabilizado = False

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-for-golden-home-app")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# INITIALIZE USERS
def init_users():
    db = database.SessionLocal()
    users_data = {
        "farevalos": "fabi_56#2_2",
        "tpolanco": "tami_98$5_5",
        "asalazar": "almi42.$%_8",
        "ivasquez": "aivan#24_90"
    }
    for username, pwd in users_data.items():
        user = db.query(models.User).filter(models.User.username == username).first()
        hashed = bcrypt.hashpw(pwd.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        if not user:
            new_user = models.User(username=username, hashed_password=hashed)
            db.add(new_user)
        else:
            user.hashed_password = hashed
    db.commit()
    db.close()

init_users()

def run_migrations():
    db = database.SessionLocal()
    try:
        from sqlalchemy import text
        
        def is_applied(name):
            try:
                return db.query(models.Migration).filter(models.Migration.name == name).first() is not None
            except Exception:
                return False

        def mark_applied(name):
            migration = models.Migration(name=name)
            db.add(migration)
            db.commit()

        # --- MIGRATIONS ---

        # Migration: migrate_old_statuses
        if not is_applied("migrate_old_statuses"):
            try:
                db.query(models.Order).filter(models.Order.status == "Pendiente de pago").update({"status": "Entregado"})
                db.commit()
                mark_applied("migrate_old_statuses")
            except Exception as e:
                print(f"Error in migration migrate_old_statuses: {e}")
                db.rollback()

        # Migration: add_include_in_close_to_orders
        if not is_applied("add_include_in_close_to_orders"):
            try:
                db.execute(text("ALTER TABLE orders ADD COLUMN include_in_close BOOLEAN DEFAULT FALSE"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_include_in_close_to_orders")

        # Migration: add_include_in_close_to_insumos
        if not is_applied("add_include_in_close_to_insumos"):
            try:
                db.execute(text("ALTER TABLE insumos ADD COLUMN include_in_close BOOLEAN DEFAULT FALSE"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_include_in_close_to_insumos")

        # Migration: add_include_in_close_to_ingresos
        if not is_applied("add_include_in_close_to_ingresos"):
            try:
                db.execute(text("ALTER TABLE ingresos ADD COLUMN include_in_close BOOLEAN DEFAULT FALSE"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_include_in_close_to_ingresos")

        # Migration: add_contabilizado_to_insumos
        if not is_applied("add_contabilizado_to_insumos"):
            try:
                db.execute(text("ALTER TABLE insumos ADD COLUMN contabilizado BOOLEAN DEFAULT FALSE"))
                db.execute(text("ALTER TABLE insumos ADD COLUMN close_period VARCHAR DEFAULT NULL"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_contabilizado_to_insumos")

        # Migration: add_period_fields_to_bank_closes
        if not is_applied("add_period_fields_to_bank_closes"):
            try:
                db.execute(text("ALTER TABLE bank_closes ADD COLUMN period VARCHAR DEFAULT NULL"))
                db.execute(text("ALTER TABLE bank_closes ADD COLUMN date_from TIMESTAMP DEFAULT NULL"))
                db.execute(text("ALTER TABLE bank_closes ADD COLUMN date_to TIMESTAMP DEFAULT NULL"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_period_fields_to_bank_closes")

        # Migration: add_contabilizado_to_ingresos
        if not is_applied("add_contabilizado_to_ingresos"):
            try:
                db.execute(text("ALTER TABLE ingresos ADD COLUMN contabilizado BOOLEAN DEFAULT FALSE"))
                db.execute(text("ALTER TABLE ingresos ADD COLUMN close_period VARCHAR DEFAULT NULL"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_contabilizado_to_ingresos")

        # Migration: add_sku_to_insumos
        if not is_applied("add_sku_to_insumos"):
            try:
                db.execute(text("ALTER TABLE insumos ADD COLUMN sku VARCHAR DEFAULT NULL"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_sku_to_insumos")

        # Migration: create_indexes
        if not is_applied("create_indexes"):
            try:
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_include_close ON orders(include_in_close)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_insumos_include_close ON insumos(include_in_close)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_insumos_contabilizado ON insumos(contabilizado)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_insumos_sku ON insumos(sku)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_ingresos_include_close ON ingresos(include_in_close)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)"))
                db.execute(text("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("create_indexes")

        # Migration: add_close_period_to_orders
        if not is_applied("add_close_period_to_orders"):
            try:
                db.execute(text("ALTER TABLE orders ADD COLUMN close_period VARCHAR DEFAULT NULL"))
                db.commit()
            except Exception: db.rollback()
            mark_applied("add_close_period_to_orders")

        # v2.0 Migration: add_contabilizado_archived_to_orders
        if not is_applied("add_contabilizado_archived_to_orders"):
            try:
                engine_url = str(database.engine.url)
                if "postgresql" in engine_url:
                    db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS contabilizado BOOLEAN DEFAULT FALSE"))
                    db.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE"))
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_contabilizado ON orders(contabilizado)"))
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_archived ON orders(archived)"))
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_close_period ON orders(close_period)"))
                else:
                    try:
                        db.execute(text("ALTER TABLE orders ADD COLUMN contabilizado BOOLEAN DEFAULT 0"))
                    except Exception: db.rollback()
                    try:
                        db.execute(text("ALTER TABLE orders ADD COLUMN archived BOOLEAN DEFAULT 0"))
                    except Exception: db.rollback()
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_contabilizado ON orders(contabilizado)"))
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_archived ON orders(archived)"))
                    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_close_period ON orders(close_period)"))
                # Migrate old status names to v2.0
                db.execute(text("UPDATE orders SET status = 'Preparado' WHERE status = 'Listo Envío'"))
                db.execute(text("UPDATE orders SET status = 'Por Pagar' WHERE status = 'Pago Pendiente'"))
                db.execute(text("UPDATE orders SET status = 'Recibido' WHERE status = 'Por preparar'"))
                db.execute(text("UPDATE orders SET status = 'Despachado' WHERE status = 'Entregado'"))
                db.execute(text("UPDATE orders SET status = 'Finalizado' WHERE status = 'Contabilizado'"))
                # Mark contabilizado based on current status
                db.execute(text("UPDATE orders SET contabilizado = 1 WHERE status = 'Finalizado'"))
                db.execute(text("UPDATE orders SET archived = 0"))
                db.commit()
                print("✅ v2.0 migration: contabilizado/archived columns added to orders")
            except Exception as e:
                print(f"v2.0 migration error: {e}")
                db.rollback()
            mark_applied("add_contabilizado_archived_to_orders")

        # v2.0 Migration: create_archived_orders_table
        if not is_applied("create_archived_orders_table"):
            try:
                engine_url = str(database.engine.url)
                if "postgresql" in engine_url:
                    db.execute(text("""
                        CREATE TABLE IF NOT EXISTS archived_orders (
                            id SERIAL PRIMARY KEY,
                            original_id INTEGER NOT NULL,
                            customer_name VARCHAR(255),
                            total FLOAT DEFAULT 0.0,
                            status VARCHAR(50),
                            payment_method VARCHAR(50),
                            created_at TIMESTAMP,
                            archived_at TIMESTAMP DEFAULT NOW(),
                            close_period VARCHAR(7),
                            total_tax FLOAT DEFAULT 0.0,
                            total_commission FLOAT DEFAULT 0.0,
                            total_real_profit FLOAT DEFAULT 0.0,
                            total_cost FLOAT DEFAULT 0.0,
                            is_live_sale BOOLEAN DEFAULT FALSE,
                            items_json TEXT,
                            notes TEXT
                        )
                    """))
                else:
                    db.execute(text("""
                        CREATE TABLE IF NOT EXISTS archived_orders (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            original_id INTEGER NOT NULL,
                            customer_name VARCHAR(255),
                            total FLOAT DEFAULT 0.0,
                            status VARCHAR(50),
                            payment_method VARCHAR(50),
                            created_at DATETIME,
                            archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            close_period VARCHAR(7),
                            total_tax FLOAT DEFAULT 0.0,
                            total_commission FLOAT DEFAULT 0.0,
                            total_real_profit FLOAT DEFAULT 0.0,
                            total_cost FLOAT DEFAULT 0.0,
                            is_live_sale BOOLEAN DEFAULT 0,
                            items_json TEXT,
                            notes TEXT
                        )
                    """))
                db.commit()
                print("✅ v2.0 migration: archived_orders table created")
            except Exception as e:
                print(f"v2.0 archived_orders table error: {e}")
                db.rollback()
            mark_applied("create_archived_orders_table")

    except Exception as e:
        print("Migration tracking error:", e)
    finally:
        db.close()


run_migrations()

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@app.post("/token", response_model=schemas.Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not bcrypt.checkpw(form_data.password.encode('utf-8'), user.hashed_password.encode('utf-8')):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

@app.post("/upload")
def upload_file(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user)):
    os.makedirs("static/photos", exist_ok=True)
    safe_filename = "".join([c for c in file.filename if c.isalnum() or c in ['.', '_', '-']]).strip()
    file_path = os.path.join("static/photos", safe_filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"url": f"/static/photos/{safe_filename}"}

@app.get("/")
def read_root(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

# --- PRODUCTS ---
@app.get("/products", response_model=schemas.PaginatedProducts)
def read_products(
    stock_filter: str = None, 
    search: str = None,
    page: int = 1, 
    limit: int = 20, 
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.Product).filter(models.Product.deleted == False)
    
    if stock_filter == "con_stock":
        query = query.filter(models.Product.stock > 0)
    elif stock_filter == "sin_stock":
        query = query.filter(models.Product.stock <= 0)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (models.Product.name.ilike(search_term)) | 
            (models.Product.sku.ilike(search_term)) |
            (models.Product.provider.ilike(search_term))
        )
        
    total = query.count()
    total_pages = (total + limit - 1) // limit
    skip = (page - 1) * limit
    products = query.order_by(models.Product.name.asc()).offset(skip).limit(limit).all()
    
    return {
        "items": products,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages
    }

@app.get("/products/{sku_or_barcode}", response_model=schemas.Product)
def get_product(sku_or_barcode: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    product = db.query(models.Product).filter(
        (models.Product.sku == sku_or_barcode) | (models.Product.barcode == sku_or_barcode)
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

@app.post("/products", response_model=schemas.Product)
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_product = models.Product(**product.dict())
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

@app.put("/products/{product_id}", response_model=schemas.Product)
def update_product(product_id: int, product_data: schemas.ProductCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    db_product.name = product_data.name
    db_product.sku = product_data.sku
    db_product.barcode = product_data.sku
    db_product.price = product_data.price
    db_product.cost = product_data.cost
    db_product.stock = product_data.stock
    db_product.provider = product_data.provider
    db_product.image_url = product_data.image_url
    db.commit()
    db.refresh(db_product)
    return db_product

@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    db_product.deleted = True
    db.commit()
    return {"message": "Product deleted successfully"}


# --- ORDERS ---
@app.post("/orders", response_model=schemas.Order)
def create_order(order: schemas.OrderCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    order_date = order.created_at if order.created_at else datetime.utcnow()
    db_order = models.Order(
        customer_name=order.customer_name, 
        status=order.status,
        payment_method=order.payment_method,
        created_at=order_date
    )
    apply_status_flags(db_order, order.status)
    db.add(db_order)
    db.commit()
    db.refresh(db_order)
    
    total = 0
    total_tax = 0
    total_commission = 0
    total_real_profit = 0
    total_cost = 0
    
    for item in order.items:
        # fetch product
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if not product:
            continue
            
        cost_unit = product.cost
        val_total = item.price * item.quantity
        margin = val_total - (cost_unit * item.quantity)
        tax = margin * 0.19
        
        # Commission is 2.6% only if Card (Tarjeta)
        if order.payment_method == "Tarjeta":
            commission = round(val_total * 0.026)
        else:
            commission = 0.0
            
        real_profit = val_total - (cost_unit * item.quantity) - tax - commission
        
        db_item = models.OrderItem(
            order_id=db_order.id, 
            product_id=item.product_id, 
            quantity=item.quantity, 
            price=item.price,
            cost_unit=cost_unit,
            tax=tax,
            commission=commission,
            real_profit=real_profit
        )
        db.add(db_item)
        
        total += val_total
        total_tax += tax
        total_commission += commission
        total_real_profit += real_profit
        total_cost += cost_unit * item.quantity
        
        # update stock (un pedido creado como Cancelado no descuenta stock)
        if order.status != "Cancelado":
            product.stock -= item.quantity
    
    db_order.total = round(total)
    db_order.total_tax = round(total_tax)
    db_order.total_commission = round(total_commission)
    db_order.total_real_profit = round(total_real_profit)
    db_order.total_cost = round(total_cost)
    
    db.commit()
    db.refresh(db_order)
    return db_order

@app.get("/orders", response_model=schemas.PaginatedOrders)
def get_orders(
    page: int = 1, 
    limit: int = 20, 
    status: str = "all",
    date_from: str = None, 
    date_to: str = None,
    payment_method: str = "all",
    search: str = None,
    is_live_sale: str = "all",
    db: Session = Depends(get_db), 
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.Order).filter(models.Order.deleted == False)
    
    if status != "all":
        query = query.filter(models.Order.status == status)
    
    if payment_method != "all":
        query = query.filter(models.Order.payment_method == payment_method)

    if is_live_sale != "all":
        if is_live_sale.lower() == "true":
            query = query.filter(models.Order.is_live_sale == True)
        else:
            query = query.filter((models.Order.is_live_sale == False) | (models.Order.is_live_sale == None))

    if date_from:
        try:
            df = datetime.strptime(date_from, "%Y-%m-%d")
            query = query.filter(models.Order.created_at >= df)
        except ValueError:
            pass
            
    if date_to:
        try:
            dt = datetime.strptime(date_to, "%Y-%m-%d")
            query = query.filter(models.Order.created_at < (dt + timedelta(days=1)))
        except ValueError:
            pass

    if search:
        search_term = f"%{search}%"
        # Search by customer name OR by product name/sku inside the order
        # To search in items, we need to join
        from sqlalchemy import cast, String
        query = query.outerjoin(models.OrderItem).outerjoin(models.Product).filter(
            (models.Order.customer_name.ilike(search_term)) | 
            (models.Product.name.ilike(search_term)) |
            (models.Product.sku.ilike(search_term)) |
            (cast(models.Order.id, String).ilike(search_term))
        ).distinct()
        
    total = query.count()
    total_pages = (total + limit - 1) // limit
    skip = (page - 1) * limit
    orders = query.order_by(models.Order.id.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": orders,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages
    }

class OrderPDF(FPDF):
    def header(self):
        # Decorative Top Banner
        self.set_fill_color(200, 150, 128) # Rose Gold
        self.rect(0, 0, 210, 5, 'F')
        
        self.ln(3)
        self.set_font('helvetica', 'B', 18)
        self.set_text_color(61, 46, 40) # Espresso Dark Brown
        self.cell(0, 8, 'PROMESSE', 0, 1, 'C')
        
        self.set_font('helvetica', 'B', 8)
        self.set_text_color(181, 127, 105) # Rose Gold Dark
        self.cell(0, 5, 'D E T A L L E S   Q U E   A B R I G A N', 0, 1, 'C')
        
        self.set_font('helvetica', 'I', 9)
        self.set_text_color(100, 100, 100)
        self.cell(0, 6, 'Comprobante de Venta / Boleta', 0, 1, 'C')
        self.ln(6)

    def footer(self):
        self.set_y(-18)
        self.set_font('helvetica', 'I', 8)
        self.set_text_color(181, 127, 105)
        self.cell(0, 5, '¡Gracias por preferir Promesse! Detalles que abrigan.', 0, 1, 'C')
        self.set_font('helvetica', '', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 5, f'Página {self.page_no()}', 0, 0, 'C')

@app.get("/orders/{order_id}/pdf")
def get_order_pdf(order_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_order = db.query(models.Order).filter(models.Order.id == order_id, models.Order.deleted == False).first()
    if not db_order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    try:
        pdf = OrderPDF()
        pdf.add_page()
        
        # Helper to sanitize text for Latin-1 core fonts
        def s(text):
            if text is None: return ""
            return str(text).encode('latin-1', 'replace').decode('latin-1')

        # Customer & Order Info Box
        pdf.set_fill_color(245, 236, 229) # Beige Soft
        pdf.rect(10, 38, 190, 20, 'F')
        
        pdf.set_xy(12, 40)
        pdf.set_font('helvetica', 'B', 11)
        pdf.set_text_color(61, 46, 40)
        pdf.cell(95, 6, s(f'Pedido #{db_order.id}'))
        pdf.set_font('helvetica', '', 9)
        pdf.cell(90, 6, s(f'Fecha: {db_order.created_at.strftime("%d/%m/%Y %H:%M") if db_order.created_at else "-"}'), align='R', ln=True)
        
        pdf.set_x(12)
        pdf.cell(95, 6, s(f'Cliente: {db_order.customer_name or "Sin nombre"}'))
        pdf.cell(90, 6, s(f'Estado: {db_order.status} | Pago: {db_order.payment_method or "-"}'), align='R', ln=True)
        pdf.ln(10)

        # Table Header
        pdf.set_fill_color(200, 150, 128) # Rose Gold Header
        pdf.set_text_color(255, 255, 255)
        pdf.set_font('helvetica', 'B', 10)
        pdf.cell(30, 9, 'SKU', 0, 0, 'C', True)
        pdf.cell(85, 9, 'Producto', 0, 0, 'L', True)
        pdf.cell(20, 9, 'Cant.', 0, 0, 'C', True)
        pdf.cell(25, 9, 'Precio', 0, 0, 'R', True)
        pdf.cell(30, 9, 'Total', 0, 1, 'R', True)

        # Table Rows
        pdf.set_text_color(61, 46, 40)
        pdf.set_font('helvetica', '', 9)
        fill_row = False
        for item in db_order.items:
            p_name = item.product.name if item.product else "Producto Eliminado"
            sku = item.product.sku if item.product else "-"
            
            if len(p_name) > 45:
                p_name = p_name[:42] + "..."
                
            if fill_row:
                pdf.set_fill_color(252, 249, 246)
            else:
                pdf.set_fill_color(255, 255, 255)
                
            pdf.cell(30, 8, s(sku), 'B', 0, 'C', True)
            pdf.cell(85, 8, s(p_name), 'B', 0, 'L', True)
            pdf.cell(20, 8, str(item.quantity), 'B', 0, 'C', True)
            
            price = item.price or 0
            pdf.cell(25, 8, f"${int(price):,}".replace(",", "."), 'B', 0, 'R', True)
            pdf.cell(30, 8, f"${int(price * item.quantity):,}".replace(",", "."), 'B', 1, 'R', True)
            fill_row = not fill_row

        # Summary
        pdf.ln(6)
        pdf.set_font('helvetica', 'B', 12)
        pdf.cell(140, 10, '')
        pdf.set_fill_color(245, 236, 229)
        pdf.set_text_color(61, 46, 40)
        total_val = db_order.total or 0
        pdf.cell(50, 10, s(f'TOTAL:  ${int(total_val):,}'.replace(",", ".")), 1, 1, 'C', True)

        pdf_bytes = pdf.output()
        return Response(
            content=bytes(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename=boleta_promesse_{db_order.id}.pdf"}
        )
    except Exception as e:
        print(f"Error generating PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Error al generar el PDF: {str(e)}")

@app.put("/orders/{order_id}", response_model=schemas.Order)
def update_order(order_id: int, order: schemas.OrderCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not db_order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    # 1. Revert stock from old items and delete old items
    # Solo devolvemos el stock si no estaba Cancelado (si estaba Cancelado el stock ya volvió a la bodega)
    if db_order.status != "Cancelado":
        for item in db_order.items:
            product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
            if product:
                product.stock += item.quantity
                
    for item in db_order.items:
        db.delete(item)
    db.commit()
    
    # 2. Process new items
    total = 0
    total_tax = 0
    total_commission = 0
    total_real_profit = 0
    total_cost = 0
    
    for item in order.items:
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if not product:
            continue
            
        cost_unit = product.cost
        val_total = item.price * item.quantity
        margin = val_total - (cost_unit * item.quantity)
        tax = margin * 0.19
        
        if order.payment_method == "Tarjeta":
            commission = round(val_total * 0.026)
        else:
            commission = 0.0
            
        real_profit = val_total - (cost_unit * item.quantity) - tax - commission
        
        db_item = models.OrderItem(
            order_id=db_order.id, 
            product_id=item.product_id, 
            quantity=item.quantity, 
            price=item.price,
            cost_unit=cost_unit,
            tax=tax,
            commission=commission,
            real_profit=real_profit
        )
        db.add(db_item)
        
        total += val_total
        total_tax += tax
        total_commission += commission
        total_real_profit += real_profit
        total_cost += cost_unit * item.quantity
        
        # Deduct stock for new items (only if not cancelled)
        if order.status != "Cancelado":
            product.stock -= item.quantity
    
    # Update order fields
    db_order.customer_name = order.customer_name
    db_order.status = order.status
    db_order.payment_method = order.payment_method
    apply_status_flags(db_order, order.status)
    if order.created_at:
        db_order.created_at = order.created_at
        
    db_order.total = round(total)
    db_order.total_tax = round(total_tax)
    db_order.total_commission = round(total_commission)
    db_order.total_real_profit = round(total_real_profit)
    db_order.total_cost = round(total_cost)
    
    db.commit()
    db.refresh(db_order)
    return db_order

@app.put("/orders/{order_id}/status")
def update_order_status(order_id: int, status: str, payment_method: str = None, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    old_status = order.status

    # v2.0: Validate transition
    if not validate_status_transition(old_status, status):
        raise HTTPException(
            status_code=400,
            detail=f"Transición inválida: '{old_status}' → '{status}'"
        )

    # v2.0: Require payment_method for Finalizado
    effective_payment = payment_method or order.payment_method
    if status == "Finalizado" and not effective_payment:
        raise HTTPException(status_code=400, detail="Método de pago requerido para Finalizar")

    order.status = status

    # 1. Update payment method if provided
    if payment_method:
        order.payment_method = payment_method

    # 2. Auto-manage include_in_close and contabilizado based on status (v2.0)
    apply_status_flags(order, status)

    # 3. Handle stock return or subtraction
    if status == "Cancelado" and old_status != "Cancelado":
        # Add stock back to bodega
        for item in order.items:
            product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
            if product:
                product.stock += item.quantity
    elif old_status == "Cancelado" and status != "Cancelado":
        # Subtract stock from bodega
        for item in order.items:
            product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
            if product:
                product.stock -= item.quantity

    # 4. Recalculate margins, taxes, commissions if payment method changed
    total_commission = 0
    total_real_profit = 0
    for item in order.items:
        if order.payment_method == "Tarjeta":
            item.commission = round((item.price * item.quantity) * 0.026)
        else:
            item.commission = 0.0
        item.real_profit = (item.price * item.quantity) - (item.cost_unit * item.quantity) - item.tax - item.commission
        total_commission += item.commission
        total_real_profit += item.real_profit

    order.total_commission = total_commission
    order.total_real_profit = total_real_profit

    db.commit()
    db.refresh(order)
    return {"id": order.id, "status": order.status, "contabilizado": order.contabilizado, "message": "Status updated successfully"}


@app.patch("/orders/{order_id}/contabilizar")
def contabilizar_order(order_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "Pagado":
        raise HTTPException(status_code=400, detail="El pedido debe estar en estado 'Pagado' para ser contabilizado")
        
    order.status = "Contabilizado"
    order.include_in_close = False
    db.commit()
    return {"message": "Pedido contabilizado"}

# --- INSUMOS ---
@app.get("/insumos", response_model=list[schemas.Insumo])
def get_insumos(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Insumo).filter(models.Insumo.contabilizado == False).order_by(models.Insumo.date.desc()).all()

@app.post("/insumos", response_model=schemas.Insumo)
def create_insumo(insumo: schemas.InsumoCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    insumo_date = insumo.date if insumo.date else datetime.utcnow()
    db_insumo = models.Insumo(
        item=insumo.item,
        sku=insumo.sku,
        cost=insumo.cost,
        date=insumo_date,
        include_in_close=insumo.include_in_close,
        payment_type=insumo.payment_type
    )
    db.add(db_insumo)
    db.commit()
    db.refresh(db_insumo)
    return db_insumo

@app.put("/insumos/{insumo_id}", response_model=schemas.Insumo)
def update_insumo(insumo_id: int, insumo_data: schemas.InsumoCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_insumo = db.query(models.Insumo).filter(models.Insumo.id == insumo_id).first()
    if not db_insumo:
        raise HTTPException(status_code=404, detail="Insumo no encontrado")
    db_insumo.item = insumo_data.item
    db_insumo.sku = insumo_data.sku
    db_insumo.cost = insumo_data.cost
    db_insumo.payment_type = insumo_data.payment_type
    if insumo_data.date:
        db_insumo.date = insumo_data.date
    db.commit()
    db.refresh(db_insumo)
    return db_insumo


# --- INGRESOS (ENTRADAS DE PRODUCTO) ---
@app.get("/ingresos", response_model=schemas.PaginatedIngresos)
def get_ingresos(
    page: int = 1,
    limit: int = 20,
    date_from: str = None,
    date_to: str = None,
    status: str = "all",
    period: str = None,
    search: str = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.Ingreso)

    if status == "pendientes":
        query = query.filter(models.Ingreso.contabilizado == False)
    elif status == "contabilizados":
        query = query.filter(models.Ingreso.contabilizado == True)
        if period:
            query = query.filter(models.Ingreso.close_period == period)

    if search:
        search_query = f"%{search}%"
        query = query.filter(
            (models.Ingreso.sku.ilike(search_query)) |
            (models.Ingreso.name.ilike(search_query)) |
            (models.Ingreso.provider.ilike(search_query))
        )

    if date_from:
        try:
            df = datetime.strptime(date_from, "%Y-%m-%d")
            query = query.filter(models.Ingreso.date >= df)
        except ValueError:
            pass
            
    if date_to:
        try:
            dt = datetime.strptime(date_to, "%Y-%m-%d")
            # Include the entire day by adding 1 day and filtering < dt
            query = query.filter(models.Ingreso.date < (dt + timedelta(days=1)))
        except ValueError:
            pass
            
    total = query.count()
    total_pages = (total + limit - 1) // limit
    skip = (page - 1) * limit
    ingresos = query.order_by(models.Ingreso.date.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": ingresos,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages
    }

@app.post("/ingresos", response_model=schemas.Ingreso)
def create_ingreso(ingreso: schemas.IngresoCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # 1. Check for duplicates on the same day (UTC)
    # Evita que se dupliquen registros por error de red o doble clic
    today = datetime.utcnow().date()
    existing = db.query(models.Ingreso).filter(
        models.Ingreso.sku == ingreso.sku,
        models.Ingreso.provider == ingreso.provider,
        models.Ingreso.quantity == ingreso.quantity,
        models.Ingreso.cost == ingreso.cost,
        func.date(models.Ingreso.date) == today
    ).first()

    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Ya existe un registro idéntico para el SKU {ingreso.sku} el día de hoy."
        )

    # 2. Save entrance record (exclude image_url which is not a column on models.Ingreso)
    ingreso_dict = ingreso.dict()
    image_url = ingreso_dict.pop("image_url", None)
    
    db_ingreso = models.Ingreso(**ingreso_dict)
    db.add(db_ingreso)
    
    # 3. Add/update product in bodega
    product = db.query(models.Product).filter(models.Product.sku == ingreso.sku).first()
    if product:
        product.name = ingreso.name
        product.provider = ingreso.provider
        product.cost = ingreso.cost
        product.price = ingreso.final_price
        product.stock += ingreso.quantity
        if image_url:
            product.image_url = image_url
    else:
        new_product = models.Product(
            sku=ingreso.sku,
            barcode=ingreso.sku,
            name=ingreso.name,
            price=ingreso.final_price,
            cost=ingreso.cost,
            stock=ingreso.quantity,
            provider=ingreso.provider,
            image_url=image_url
        )
        db.add(new_product)
        
    db.commit()
    db.refresh(db_ingreso)
    return db_ingreso

@app.put("/ingresos/{ingreso_id}", response_model=schemas.Ingreso)
def update_ingreso(ingreso_id: int, ingreso_data: schemas.IngresoCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_ingreso = db.query(models.Ingreso).filter(models.Ingreso.id == ingreso_id).first()
    if not db_ingreso:
        raise HTTPException(status_code=404, detail="Ingreso no encontrado")
        
    old_sku = db_ingreso.sku
    old_qty = db_ingreso.quantity
    
    # Update ingress log (excluding image_url)
    ingreso_dict = ingreso_data.dict()
    image_url = ingreso_dict.pop("image_url", None)
    
    db_ingreso.provider = ingreso_data.provider
    db_ingreso.sku = ingreso_data.sku
    db_ingreso.name = ingreso_data.name
    db_ingreso.cost = ingreso_data.cost
    db_ingreso.suggested_price = ingreso_data.suggested_price
    db_ingreso.final_price = ingreso_data.final_price
    db_ingreso.quantity = ingreso_data.quantity
    db_ingreso.payment_type = ingreso_data.payment_type
    
    # Subtract old quantity from old product SKU in bodega
    old_product = db.query(models.Product).filter(models.Product.sku == old_sku).first()
    if old_product:
        old_product.stock -= old_qty
        
    # Add new quantity to new product SKU in bodega
    product = db.query(models.Product).filter(models.Product.sku == ingreso_data.sku).first()
    if product:
        product.name = ingreso_data.name
        product.provider = ingreso_data.provider
        product.cost = ingreso_data.cost
        product.price = ingreso_data.final_price
        product.stock += ingreso_data.quantity
        if image_url:
            product.image_url = image_url
    else:
        new_product = models.Product(
            sku=ingreso_data.sku,
            barcode=ingreso_data.sku,
            name=ingreso_data.name,
            price=ingreso_data.final_price,
            cost=ingreso_data.cost,
            stock=ingreso_data.quantity,
            provider=ingreso_data.provider,
            image_url=image_url
        )
        db.add(new_product)
        
    db.commit()
    db.refresh(db_ingreso)
    return db_ingreso

@app.delete("/ingresos/{ingreso_id}")
def delete_ingreso(ingreso_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_ingreso = db.query(models.Ingreso).filter(models.Ingreso.id == ingreso_id).first()
    if not db_ingreso:
        raise HTTPException(status_code=404, detail="Ingreso no encontrado")
        
    # Remove qty from stock
    product = db.query(models.Product).filter(models.Product.sku == db_ingreso.sku).first()
    if product:
        product.stock -= db_ingreso.quantity
        
    db.delete(db_ingreso)
    db.commit()
    return {"message": "Ingreso eliminado"}

@app.patch("/orders/{order_id}/toggle-close")
def toggle_order_close(order_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Not found")
    order.include_in_close = not order.include_in_close
    db.commit()
    return {"status": "ok", "include_in_close": order.include_in_close}

@app.patch("/insumos/{insumo_id}/toggle-close")
def toggle_insumo_close(insumo_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    insumo = db.query(models.Insumo).filter(models.Insumo.id == insumo_id).first()
    if not insumo:
        raise HTTPException(status_code=404, detail="Not found")
    insumo.include_in_close = not insumo.include_in_close
    db.commit()
    return {"status": "ok", "include_in_close": insumo.include_in_close}

@app.patch("/ingresos/{ingreso_id}/toggle-close")
def toggle_ingreso_close(ingreso_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    ingreso = db.query(models.Ingreso).filter(models.Ingreso.id == ingreso_id).first()
    if not ingreso:
        raise HTTPException(status_code=404, detail="Not found")
    ingreso.include_in_close = not ingreso.include_in_close
    db.commit()
    return {"status": "ok", "include_in_close": ingreso.include_in_close}

# --- VAT / IVA PAYMENTS ---
@app.post("/vat-payments", response_model=schemas.VatPayment)
def pay_vat(payment: schemas.VatPaymentCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_payment = models.VatPayment(**payment.dict())
    db.add(db_payment)
    db.commit()
    db.refresh(db_payment)
    return db_payment

# --- DASHBOARD & MONTHLY CLOSE ---
@app.get("/dashboard")
def get_dashboard_metrics(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Contabilizado en v2.0 es Finalizado
    paid_sales_sum = db.query(func.sum(models.Order.total)).filter(
        models.Order.status == "Finalizado", 
        models.Order.deleted == False,
        models.Order.archived == False
    ).scalar() or 0.0
    
    paid_profit_sum = db.query(func.sum(models.Order.total_real_profit)).filter(
        models.Order.status == "Finalizado", 
        models.Order.deleted == False,
        models.Order.archived == False
    ).scalar() or 0.0
    
    # Low stock products
    low_stock = db.query(models.Product).filter(models.Product.stock < 10).count()
    
    # Costo Total Insumos
    total_insumos_cost = db.query(func.sum(models.Insumo.cost)).scalar() or 0.0
    
    # Net Gain: Real Profit - Insumos Cost
    net_gain = paid_profit_sum - total_insumos_cost
    
    # Calculate IVA/VAT
    total_vat_owed = db.query(func.sum(models.Order.total_tax)).filter(
        models.Order.status == "Finalizado", 
        models.Order.deleted == False,
        models.Order.archived == False
    ).scalar() or 0.0
    total_vat_paid = db.query(func.sum(models.VatPayment.amount)).scalar() or 0.0
    vat_balance = max(0.0, total_vat_owed - total_vat_paid)

    paid_orders_count = db.query(models.Order).filter(
        models.Order.status == "Finalizado", 
        models.Order.deleted == False,
        models.Order.archived == False
    ).count()

    # Función para traer listas por estado
    def get_orders(st):
        return db.query(models.Order).filter(
            models.Order.status == st, 
            models.Order.deleted == False,
            models.Order.archived == False
        ).order_by(models.Order.created_at.desc()).all()

    orders_recibido = get_orders("Recibido")
    orders_en_preparacion = get_orders("En Preparación")
    orders_preparado = get_orders("Preparado")
    orders_despachado = get_orders("Despachado")
    orders_pagado = get_orders("Pagado")
    orders_por_pagar = get_orders("Por Pagar")
    orders_finalizado = get_orders("Finalizado")
    orders_cancelado = get_orders("Cancelado")

    def serialize_dashboard_order(order):
        items_desc = ", ".join([f"{item.quantity}x {item.product.name if item.product else 'Producto'}" for item in order.items])
        return {
            "id": order.id,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "customer_name": order.customer_name or "Sin nombre",
            "total": order.total,
            "status": order.status,
            "items_summary": items_desc
        }

    return {
        "total_sales": paid_sales_sum,
        "low_stock_count": low_stock,
        "paid_orders_count": paid_orders_count,
        "total_real_profit": paid_profit_sum,
        "total_insumos_cost": total_insumos_cost,
        "net_gain": net_gain,
        "vat_owed": vat_balance,
        
        "orders_recibido": [serialize_dashboard_order(o) for o in orders_recibido],
        "orders_en_preparacion": [serialize_dashboard_order(o) for o in orders_en_preparacion],
        "orders_preparado": [serialize_dashboard_order(o) for o in orders_preparado],
        "orders_despachado": [serialize_dashboard_order(o) for o in orders_despachado],
        "orders_pagado": [serialize_dashboard_order(o) for o in orders_pagado],
        "orders_por_pagar": [serialize_dashboard_order(o) for o in orders_por_pagar],
        "orders_finalizado": [serialize_dashboard_order(o) for o in orders_finalizado],
        "orders_cancelado": [serialize_dashboard_order(o) for o in orders_cancelado],
        
        "sales_by_customer": get_sales_by_customer(db)
    }

def get_sales_by_customer(db: Session):
    # Group by customer_name and sum totals
    results = db.query(
        models.Order.customer_name,
        func.sum(models.Order.total).label("total_sales"),
        func.sum(models.Order.total_real_profit).label("total_profit")
    ).filter(models.Order.deleted == False).group_by(models.Order.customer_name).all()
    
    return [{"customer_name": r[0] or "Sin nombre", "total_sales": r[1], "total_profit": r[2]} for r in results]

@app.post("/orders/import-excel-preview")
async def import_orders_excel_preview(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Normalize column names to lowercase for consistency
        df.columns = [str(col).lower().strip() for col in df.columns]
        
        # Map common column variations
        column_mapping = {
            "cliente": "nombre",
            "valor total": "valor_total",
            "precio bodega": "precio_bodega",
            "precio venta": "precio_venta",
            "producto": "producto_nombre"
        }
        
        for old_col, new_col in column_mapping.items():
            if old_col in df.columns and new_col not in df.columns:
                df[new_col] = df[old_col]
        
        if "nombre" not in df.columns:
            df["nombre"] = "Importado Excel"
            
        preview_data = []
        
        # Grouping by customer name
        for customer_name, group in df.groupby("nombre"):
            if pd.isna(customer_name) or str(customer_name).strip() == "":
                customer_name = "Importado Excel"
            
            # Group items by SKU and product_nombre within the customer
            # SKU and product_nombre might be NaN, so we handle that
            group["sku"] = group["sku"].fillna("S/SKU")
            group["producto_nombre"] = group["producto_nombre"].fillna("Producto")
            
            items_grouped = group.groupby(["sku", "producto_nombre"], sort=False)
            items_summary = []
            order_total = 0
            
            for (sku, prod_name), p_group in items_grouped:
                cantidad = int(p_group["cantidad"].sum())
                valor_total = float(p_group["valor_total"].sum())
                order_total += valor_total
                
                items_summary.append({
                    "sku": str(sku),
                    "name": str(prod_name),
                    "quantity": cantidad,
                    "total": valor_total
                })
            
            preview_data.append({
                "customer_name": str(customer_name),
                "items": items_summary,
                "total": order_total
            })
            
        return {"orders": preview_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al procesar vista previa: {str(e)}")

@app.post("/orders/import-excel")
async def import_orders_excel(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Normalize column names to lowercase for consistency
        df.columns = [str(col).lower().strip() for col in df.columns]
        
        # Map common column variations
        column_mapping = {
            "cliente": "nombre",
            "valor total": "valor_total",
            "precio bodega": "precio_bodega",
            "precio venta": "precio_venta",
            "producto": "producto_nombre"
        }
        
        for old_col, new_col in column_mapping.items():
            if old_col in df.columns and new_col not in df.columns:
                df[new_col] = df[old_col]
        
        if "nombre" not in df.columns:
            df["nombre"] = "Importado Excel"
            
        # Group by customer name to create one order per customer
        imported_orders_count = 0
        
        # Grouping by customer name
        for customer_name, group in df.groupby("nombre"):
            if pd.isna(customer_name) or str(customer_name).strip() == "":
                customer_name = "Importado Excel"
            
            # Use the first row for order-level info
            first_row = group.iloc[0]
            fecha_raw = first_row.get("fecha")
            if pd.isna(fecha_raw):
                fecha = datetime.utcnow()
            elif isinstance(fecha_raw, datetime):
                fecha = fecha_raw
            else:
                try:
                    fecha = pd.to_datetime(fecha_raw, dayfirst=True).to_pydatetime()
                except:
                    fecha = datetime.utcnow()
            
            estado = str(first_row.get("estado", "Entregado"))
            
            # Create Order first (we will update totals later)
            db_order = models.Order(
                customer_name=str(customer_name),
                status=estado,
                payment_method="-",
                created_at=fecha,
                total=0,
                total_cost=0,
                total_real_profit=0,
                include_in_close=False,
                is_live_sale=True
            )
            db.add(db_order)
            db.commit()
            db.refresh(db_order)
            
            order_total = 0
            order_total_cost = 0
            order_total_profit = 0
            
            # Group items by SKU and product_nombre to group by name as requested
            group["sku"] = group["sku"].fillna("S/SKU")
            group["producto_nombre"] = group["producto_nombre"].fillna("Producto")
            items_grouped = group.groupby(["sku", "producto_nombre"], sort=False)

            for (sku, prod_name), p_group in items_grouped:
                sku = str(sku).strip()
                if not sku or sku == "nan" or sku == "S/SKU":
                    # If no SKU, we still want to create the item but maybe use a generic one or create it by name
                    sku = f"GEN-{prod_name[:10]}"
                
                cantidad = int(p_group["cantidad"].sum())
                valor_total_item = float(p_group["valor_total"].sum())
                
                # Take average prices from the group if they exist, otherwise 0
                precio_bodega = float(p_group["precio_bodega"].iloc[0] if "precio_bodega" in p_group.columns and not pd.isna(p_group["precio_bodega"].iloc[0]) else 0)
                precio_venta = float(p_group["precio_venta"].iloc[0] if "precio_venta" in p_group.columns and not pd.isna(p_group["precio_venta"].iloc[0]) else (valor_total_item / cantidad if cantidad > 0 else 0))
                
                # Find product
                product = db.query(models.Product).filter(models.Product.sku == sku).first()
                
                if not product:
                    # If product doesn't exist, try to create it
                    product = models.Product(
                        sku=sku,
                        barcode=sku,
                        name=str(prod_name),
                        price=precio_venta,
                        cost=precio_bodega,
                        stock=0
                    )
                    db.add(product)
                    db.commit()
                    db.refresh(product)

                if precio_bodega == 0:
                    precio_bodega = product.cost
                
                if precio_venta == 0 and cantidad > 0:
                    precio_venta = valor_total_item / cantidad
                
                resta = valor_total_item - (precio_bodega * cantidad)

                # Create OrderItem
                db_item = models.OrderItem(
                    order_id=db_order.id,
                    product_id=product.id,
                    quantity=cantidad,
                    price=precio_venta,
                    cost_unit=precio_bodega,
                    real_profit=resta
                )
                db.add(db_item)
                
                # Update running totals
                order_total += valor_total_item
                order_total_cost += (precio_bodega * cantidad)
                order_total_profit += resta
                
                # Discount from stock
                product.stock -= cantidad
            
            # Update order totals
            db_order.total = order_total
            db_order.total_cost = order_total_cost
            db_order.total_real_profit = order_total_profit
            db.commit()
            
            imported_orders_count += 1
            
        return {"message": f"Se importaron {imported_orders_count} pedidos exitosamente agrupados por nombre."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al importar Excel: {str(e)}")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al importar Excel: {str(e)}")

@app.get("/bank-close/preview")
def bank_close_preview(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    import calendar
    now = datetime.utcnow()
    date_from = datetime(now.year, now.month, 1)
    last_day = calendar.monthrange(now.year, now.month)[1]
    date_to = datetime(now.year, now.month, last_day, 23, 59, 59)
    current_period = f"{now.year}-{now.month:02d}"

    last_close_efectivo = db.query(models.BankClose).filter(models.BankClose.close_type == "Efectivo").order_by(models.BankClose.id.desc()).first()
    last_close_tarjeta = db.query(models.BankClose).filter(models.BankClose.close_type == "Tarjeta/Transferencia").order_by(models.BankClose.id.desc()).first()
    
    saldo_inicial_efectivo = last_close_efectivo.saldo_real if (last_close_efectivo and last_close_efectivo.saldo_real is not None) else 0.0
    saldo_inicial_tarjeta = last_close_tarjeta.saldo_real if (last_close_tarjeta and last_close_tarjeta.saldo_real is not None) else 0.0
    
    # Efectivo
    ventas_efectivo = db.query(func.sum(models.Order.total)).filter(
        models.Order.include_in_close == True,
        models.Order.status.in_(BANK_CLOSE_STATUSES),
        models.Order.payment_method == "Efectivo",
        models.Order.deleted == False
    ).scalar() or 0.0
    
    insumos_efectivo = db.query(func.sum(models.Insumo.cost)).filter(
        models.Insumo.include_in_close == True,
        models.Insumo.payment_type == "Efectivo"
    ).scalar() or 0.0
    
    ingresos_efectivo = db.query(func.sum(models.Ingreso.cost * models.Ingreso.quantity)).filter(
        models.Ingreso.include_in_close == True,
        models.Ingreso.payment_type == "Efectivo"
    ).scalar() or 0.0
    
    # Tarjeta / Transferencia
    ventas_transferencia = db.query(func.sum(models.Order.total)).filter(
        models.Order.include_in_close == True,
        models.Order.status.in_(BANK_CLOSE_STATUSES),
        models.Order.payment_method == "Transferencia",
        models.Order.deleted == False
    ).scalar() or 0.0
    
    ventas_tarjeta_netas = db.query(func.sum(models.Order.total - models.Order.total_commission)).filter(
        models.Order.include_in_close == True,
        models.Order.status.in_(BANK_CLOSE_STATUSES),
        models.Order.payment_method == "Tarjeta",
        models.Order.deleted == False
    ).scalar() or 0.0
    
    insumos_tarjeta = db.query(func.sum(models.Insumo.cost)).filter(
        models.Insumo.include_in_close == True,
        models.Insumo.payment_type != "Efectivo"
    ).scalar() or 0.0
    
    ingresos_tarjeta = db.query(func.sum(models.Ingreso.cost * models.Ingreso.quantity)).filter(
        models.Ingreso.include_in_close == True,
        models.Ingreso.payment_type != "Efectivo"
    ).scalar() or 0.0
    
    saldo_esperado_efectivo = saldo_inicial_efectivo + ventas_efectivo - insumos_efectivo - ingresos_efectivo
    saldo_esperado_tarjeta = saldo_inicial_tarjeta + ventas_transferencia + ventas_tarjeta_netas - insumos_tarjeta - ingresos_tarjeta
    
    # Counts Breakdown
    # Efectivo
    orders_ef = db.query(models.Order).filter(models.Order.include_in_close == True, models.Order.status.in_(BANK_CLOSE_STATUSES), (models.Order.is_live_sale == False) | (models.Order.is_live_sale == None), models.Order.payment_method == "Efectivo", models.Order.deleted == False).count()
    live_ef = db.query(models.Order).filter(models.Order.include_in_close == True, models.Order.status.in_(BANK_CLOSE_STATUSES), models.Order.is_live_sale == True, models.Order.payment_method == "Efectivo", models.Order.deleted == False).count()
    insumos_ef = db.query(models.Insumo).filter(models.Insumo.include_in_close == True, models.Insumo.payment_type == "Efectivo").count()
    ingresos_ef = db.query(models.Ingreso).filter(models.Ingreso.include_in_close == True, models.Ingreso.payment_type == "Efectivo").count()
    
    # Tarjeta
    orders_tj = db.query(models.Order).filter(models.Order.include_in_close == True, models.Order.status.in_(BANK_CLOSE_STATUSES), (models.Order.is_live_sale == False) | (models.Order.is_live_sale == None), models.Order.payment_method != "Efectivo", models.Order.deleted == False).count()
    live_tj = db.query(models.Order).filter(models.Order.include_in_close == True, models.Order.status.in_(BANK_CLOSE_STATUSES), models.Order.is_live_sale == True, models.Order.payment_method != "Efectivo", models.Order.deleted == False).count()
    insumos_tj = db.query(models.Insumo).filter(models.Insumo.include_in_close == True, models.Insumo.payment_type != "Efectivo").count()
    ingresos_tj = db.query(models.Ingreso).filter(models.Ingreso.include_in_close == True, models.Ingreso.payment_type != "Efectivo").count()

    return {
        "has_initial": (last_close_efectivo is not None) or (last_close_tarjeta is not None),
        "period": current_period,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "efectivo": {
            "saldo_inicial": saldo_inicial_efectivo,
            "ventas": ventas_efectivo,
            "insumos": insumos_efectivo,
            "ingresos": ingresos_efectivo,
            "saldo_esperado": saldo_esperado_efectivo,
            "counts": {
                "orders": orders_ef,
                "live_sales": live_ef,
                "insumos": insumos_ef,
                "ingresos": ingresos_ef
            }
        },
        "tarjeta": {
            "saldo_inicial": saldo_inicial_tarjeta,
            "ventas_transferencia": ventas_transferencia,
            "ventas_tarjeta_netas": ventas_tarjeta_netas,
            "insumos": insumos_tarjeta,
            "ingresos": ingresos_tarjeta,
            "saldo_esperado": saldo_esperado_tarjeta,
            "counts": {
                "orders": orders_tj,
                "live_sales": live_tj,
                "insumos": insumos_tj,
                "ingresos": ingresos_tj
            }
        }
    }

@app.post("/bank-close", response_model=schemas.BankClose)
def create_bank_close(data: schemas.BankCloseCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    preview = bank_close_preview(db=db, current_user=current_user)
    
    close_type = data.close_type
    key = "efectivo" if close_type == "Efectivo" else "tarjeta"
    
    period = preview["period"]
    date_from = datetime.fromisoformat(preview["date_from"])
    date_to = datetime.fromisoformat(preview["date_to"])
    
    ajustes_positivos = sum(a.monto for a in data.adjustments if a.tipo == "ingreso")
    ajustes_negativos = sum(a.monto for a in data.adjustments if a.tipo == "egreso")
    
    if not preview["has_initial"] and data.saldo_real is None:
        base_esperado = data.saldo_inicial
        final_esperado = base_esperado + ajustes_positivos - ajustes_negativos
        close_record = models.BankClose(
            close_type=close_type,
            saldo_inicial=data.saldo_inicial,
            saldo_esperado=final_esperado,
            saldo_real=data.saldo_inicial,
            diferencia=0,
            notas=data.notas,
            period=period,
            date_from=date_from,
            date_to=date_to
        )
    else:
        p_data = preview[key]
        base_esperado = p_data["saldo_esperado"]
        final_esperado = base_esperado + ajustes_positivos - ajustes_negativos
        
        diff = 0
        if data.saldo_real is not None:
            diff = data.saldo_real - final_esperado
            
        close_record = models.BankClose(
            close_type=close_type,
            saldo_inicial=p_data["saldo_inicial"],
            saldo_esperado=final_esperado,
            saldo_real=data.saldo_real,
            diferencia=diff,
            notas=data.notas,
            period=period,
            date_from=date_from,
            date_to=date_to
        )
        
        # Mark transactions as contabilizado
        if close_type == "Efectivo":
            db.query(models.Order).filter(
                models.Order.include_in_close == True, 
                models.Order.status.in_(BANK_CLOSE_STATUSES),
                models.Order.deleted == False,
                models.Order.payment_method == "Efectivo"
            ).update({"include_in_close": False, "close_period": period}, synchronize_session=False)
            
            db.query(models.Insumo).filter(
                models.Insumo.include_in_close == True, 
                models.Insumo.payment_type == "Efectivo"
            ).update({"contabilizado": True, "close_period": period, "include_in_close": False})
            
            db.query(models.Ingreso).filter(
                models.Ingreso.include_in_close == True, 
                models.Ingreso.payment_type == "Efectivo"
            ).update({"contabilizado": True, "close_period": period, "include_in_close": False}) 
        else:
            db.query(models.Order).filter(
                models.Order.include_in_close == True, 
                models.Order.status.in_(BANK_CLOSE_STATUSES),
                models.Order.deleted == False,
                models.Order.payment_method != "Efectivo"
            ).update({"include_in_close": False, "close_period": period}, synchronize_session=False)
            
            db.query(models.Insumo).filter(
                models.Insumo.include_in_close == True, 
                models.Insumo.payment_type != "Efectivo"
            ).update({"contabilizado": True, "close_period": period, "include_in_close": False})
            
            db.query(models.Ingreso).filter(
                models.Ingreso.include_in_close == True, 
                models.Ingreso.payment_type != "Efectivo"
            ).update({"contabilizado": True, "close_period": period, "include_in_close": False})

    db.add(close_record)
    db.commit()
    db.refresh(close_record)
    
    # Save adjustments
    for adj in data.adjustments:
        db_adj = models.BankCloseAdjustment(
            close_id=close_record.id,
            tipo=adj.tipo,
            monto=adj.monto,
            comentario=adj.comentario
        )
        db.add(db_adj)
    db.commit()
    db.refresh(close_record)
    
    return close_record

@app.get("/bank-closes", response_model=list[schemas.BankClose])
def get_bank_closes(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.BankClose).order_by(models.BankClose.created_at.desc()).all()

@app.get("/bank-close/{close_id}", response_model=schemas.BankClose)
def get_bank_close(close_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    close = db.query(models.BankClose).filter(models.BankClose.id == close_id).first()
    if not close:
        raise HTTPException(status_code=404, detail="Bank close not found")
    return close

@app.delete("/bank-close/{close_id}")
def delete_bank_close(close_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    close = db.query(models.BankClose).filter(models.BankClose.id == close_id).first()
    if not close:
        raise HTTPException(status_code=404, detail="Bank close not found")
    
    # Revert bank-close mark of transactions (el estado de los pedidos no cambia)
    period = close.period
    close_type = close.close_type
    
    if close_type == "Efectivo":
        db.query(models.Order).filter(models.Order.close_period == period, models.Order.archived == False, models.Order.status.in_(BANK_CLOSE_STATUSES), models.Order.payment_method == "Efectivo").update({"include_in_close": True, "close_period": None}, synchronize_session=False)
        db.query(models.Insumo).filter(models.Insumo.close_period == period, models.Insumo.payment_type == "Efectivo").update({"contabilizado": False, "close_period": None, "include_in_close": True})
        db.query(models.Ingreso).filter(models.Ingreso.close_period == period, models.Ingreso.payment_type == "Efectivo").update({"contabilizado": False, "close_period": None, "include_in_close": True})
    else:
        db.query(models.Order).filter(models.Order.close_period == period, models.Order.archived == False, models.Order.status.in_(BANK_CLOSE_STATUSES), models.Order.payment_method != "Efectivo").update({"include_in_close": True, "close_period": None}, synchronize_session=False)
        db.query(models.Insumo).filter(models.Insumo.close_period == period, models.Insumo.payment_type != "Efectivo").update({"contabilizado": False, "close_period": None, "include_in_close": True})
        db.query(models.Ingreso).filter(models.Ingreso.close_period == period, models.Ingreso.payment_type != "Efectivo").update({"contabilizado": False, "close_period": None, "include_in_close": True})
    
    # Delete adjustments
    db.query(models.BankCloseAdjustment).filter(models.BankCloseAdjustment.close_id == close_id).delete()
    
    # Delete close record
    db.delete(close)
    db.commit()
    
    return {"message": "Cierre revertido exitosamente"}

@app.post("/bank-close/{close_id}/adjustment", response_model=schemas.BankCloseAdjustment)
def add_bank_close_adjustment(close_id: int, adjustment: schemas.BankCloseAdjustmentCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    close = db.query(models.BankClose).filter(models.BankClose.id == close_id).first()
    if not close:
        raise HTTPException(status_code=404, detail="Bank close not found")
        
    db_adj = models.BankCloseAdjustment(
        close_id=close_id,
        tipo=adjustment.tipo,
        monto=adjustment.monto,
        comentario=adjustment.comentario
    )
    db.add(db_adj)
    
    # Update expected balance of the close record
    if adjustment.tipo == "ingreso":
        close.saldo_esperado += adjustment.monto
    elif adjustment.tipo == "egreso":
        close.saldo_esperado -= adjustment.monto
        
    if close.saldo_real is not None:
        close.diferencia = close.saldo_real - close.saldo_esperado
        
    db.commit()
    db.refresh(db_adj)
    return db_adj

@app.get("/insumos/contabilizados", response_model=list[schemas.Insumo])
def get_insumos_contabilizados(period: str = None, payment_type: str = None, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    query = db.query(models.Insumo).filter(models.Insumo.contabilizado == True)
    if period:
        query = query.filter(models.Insumo.close_period == period)
    if payment_type:
        query = query.filter(models.Insumo.payment_type == payment_type)
    return query.order_by(models.Insumo.date.desc()).all()

@app.delete("/orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(order_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    if order.deleted:
        raise HTTPException(status_code=400, detail="Pedido ya eliminado")

    # Restaurar stock de los productos si aplica.
    # En este caso devolvemos el stock independientemente del estado (asumiendo que si no estaba en un estado final de todas formas lo queremos borrar, 
    # pero el flujo dicta que el stock se descontó cuando pasó a preparado/entregado. Si está en "Cancelado" ya no se cuenta.
    # Pero Wait, previously "update_order" handles stock rollback if status != "Cancelado".
    # We will do a simple rollback if status != Cancelado
    if order.status != "Cancelado":
        for item in order.items:
            prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
            if prod:
                prod.stock += item.quantity

    order.include_in_close = False
    order.deleted = True
    db.commit()
    return None

# --- MAINTENANCE & EXPORT ---
@app.get("/products/export/excel")
def export_products_excel(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    products = db.query(models.Product).filter(models.Product.deleted == False).all()
    
    data = []
    for p in products:
        data.append({
            "SKU": p.sku,
            "Código de Barras": p.barcode,
            "Nombre": p.name,
            "Precio Venta": p.price,
            "Costo": p.cost,
            "Stock": p.stock,
            "Proveedor": p.provider,
            "Fecha Creación": p.created_at.strftime("%Y-%m-%d %H:%M:%S") if p.created_at else ""
        })
    
    df = pd.DataFrame(data)
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Bodega')
    
    output.seek(0)
    
    headers = {
        'Content-Disposition': 'attachment; filename="inventario_bodega.xlsx"'
    }
    return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@app.delete("/maintenance/purge-contabilizados")
def purge_contabilizados(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    one_month_ago = datetime.utcnow() - timedelta(days=30)
    
    # 1. Purge Orders (and their items)
    # Since OrderItem has ForeignKey(orders.id), we should delete items first if not cascading.
    # In models.py, Order has relationship("OrderItem", back_populates="order")
    # I'll delete items manually to be safe.
    
    orders_to_purge = db.query(models.Order).filter(
        models.Order.status == "Contabilizado",
        models.Order.created_at < one_month_ago
    ).all()
    
    order_ids = [o.id for o in orders_to_purge]
    
    if order_ids:
        db.query(models.OrderItem).filter(models.OrderItem.order_id.in_(order_ids)).delete(synchronize_session=False)
        db.query(models.Order).filter(models.Order.id.in_(order_ids)).delete(synchronize_session=False)
    
    # 2. Purge Insumos
    insumos_deleted = db.query(models.Insumo).filter(
        models.Insumo.contabilizado == True,
        models.Insumo.date < one_month_ago
    ).delete(synchronize_session=False)
    
    # 3. Purge Ingresos
    ingresos_deleted = db.query(models.Ingreso).filter(
        models.Ingreso.contabilizado == True,
        models.Ingreso.date < one_month_ago
    ).delete(synchronize_session=False)
    
    db.commit()
    
    return {
        "message": "Purga completada exitosamente",
        "orders_purged": len(order_ids),
        "insumos_purged": insumos_deleted,
        "ingresos_purged": ingresos_deleted
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


# ============================================================
# v2.0 - REPORTERÍA (4 tabs)
# ============================================================

from fastapi import Query as QueryParam

@app.get("/reports/orders")
def get_report_orders(
    date_from: str = QueryParam(None),
    date_to: str = QueryParam(None),
    statuses: str = QueryParam(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Reportería de pedidos: archivados (post-cierre) y también los aún no archivados
    (Pagado, Por Pagar, Finalizado sin cierre, etc.). Los filtra por fecha y estado."""
    query = db.query(models.Order).filter(
        models.Order.deleted == False
    )
    if date_from:
        try:
            query = query.filter(models.Order.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(models.Order.created_at <= datetime.fromisoformat(date_to) + timedelta(days=1))
        except ValueError:
            pass
    if statuses:
        status_list = [s.strip() for s in statuses.split(",") if s.strip()]
        if status_list:
            query = query.filter(models.Order.status.in_(status_list))

    items = query.order_by(models.Order.created_at.desc()).all()
    total_revenue = sum(o.total or 0 for o in items)

    return {
        "items": [
            {
                "id": o.id,
                "customer_name": o.customer_name or "Sin nombre",
                "status": o.status,
                "total": o.total,
                "payment_method": o.payment_method,
                "created_at": o.created_at.isoformat() if o.created_at else None,
                "close_period": o.close_period,
                "contabilizado": o.contabilizado
            }
            for o in items
        ],
        "total_count": len(items),
        "total_revenue": total_revenue,
        "total_orders": len(items)
    }


@app.get("/reports/insumos")
def get_report_insumos(
    date_from: str = QueryParam(None),
    date_to: str = QueryParam(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Reportería de insumos: contabilizados y también los aún sin contabilizar"""
    query = db.query(models.Insumo)
    if date_from:
        try:
            query = query.filter(models.Insumo.date >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(models.Insumo.date <= datetime.fromisoformat(date_to) + timedelta(days=1))
        except ValueError:
            pass

    items = query.order_by(models.Insumo.date.desc()).all()
    total_cost = sum(i.cost or 0 for i in items)

    return {
        "items": [
            {
                "id": i.id,
                "item": i.item,
                "sku": i.sku,
                "cost": i.cost,
                "date": i.date.isoformat() if i.date else None,
                "payment_type": i.payment_type,
                "close_period": i.close_period
            }
            for i in items
        ],
        "total_cost": total_cost
    }


@app.get("/reports/ingresos")
def get_report_ingresos(
    date_from: str = QueryParam(None),
    date_to: str = QueryParam(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Reportería de ingresos (bodega): contabilizados y también los aún sin contabilizar"""
    query = db.query(models.Ingreso)
    if date_from:
        try:
            query = query.filter(models.Ingreso.date >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(models.Ingreso.date <= datetime.fromisoformat(date_to) + timedelta(days=1))
        except ValueError:
            pass

    items = query.order_by(models.Ingreso.date.desc()).all()
    total = sum((i.quantity or 0) * (i.final_price or 0) for i in items)

    return {
        "items": [
            {
                "id": i.id,
                "sku": i.sku,
                "name": i.name,
                "quantity": i.quantity,
                "cost": i.cost,
                "final_price": i.final_price,
                "date": i.date.isoformat() if i.date else None,
                "close_period": i.close_period,
                "payment_type": i.payment_type
            }
            for i in items
        ],
        "total": total
    }


@app.get("/reports/summary")
def get_report_summary(
    date_from: str = QueryParam(None),
    date_to: str = QueryParam(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Resumen financiero del período seleccionado"""
    q_orders = db.query(models.Order).filter(
        models.Order.archived == True,
        models.Order.deleted == False,
        models.Order.status == "Finalizado"
    )
    q_insumos = db.query(models.Insumo).filter(models.Insumo.contabilizado == True)
    q_ingresos = db.query(models.Ingreso).filter(models.Ingreso.contabilizado == True)

    if date_from:
        try:
            df_dt = datetime.fromisoformat(date_from)
            q_orders = q_orders.filter(models.Order.created_at >= df_dt)
            q_insumos = q_insumos.filter(models.Insumo.date >= df_dt)
            q_ingresos = q_ingresos.filter(models.Ingreso.date >= df_dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt_dt = datetime.fromisoformat(date_to) + timedelta(days=1)
            q_orders = q_orders.filter(models.Order.created_at <= dt_dt)
            q_insumos = q_insumos.filter(models.Insumo.date <= dt_dt)
            q_ingresos = q_ingresos.filter(models.Ingreso.date <= dt_dt)
        except ValueError:
            pass

    orders = q_orders.all()
    insumos = q_insumos.all()
    ingresos = q_ingresos.all()

    total_revenue_orders = sum(o.total or 0 for o in orders)
    total_cost_orders = sum(o.total_cost or 0 for o in orders)
    total_profit_orders = total_revenue_orders - total_cost_orders
    total_insumos = sum(i.cost or 0 for i in insumos)
    total_ingresos = sum((i.quantity or 0) * (i.final_price or 0) for i in ingresos)
    net_profit = total_profit_orders + total_ingresos - total_insumos

    return {
        "summary": {
            "total_revenue_orders": total_revenue_orders,
            "total_cost_orders": total_cost_orders,
            "total_profit_orders": total_profit_orders,
            "total_insumos_cost": total_insumos,
            "total_ingresos": total_ingresos,
            "net_profit": net_profit,
            "period_from": date_from or "inicio",
            "period_to": date_to or "hoy"
        }
    }


# ============================================================
# v2.0 - CIERRE DE PERÍODO (Archiva órdenes Finalizado)
# ============================================================

@app.post("/close-period")
def close_period_v2(
    period: str = QueryParam(..., description="Formato YYYY-MM"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Cierre de período v2.0:
    1. Busca órdenes: status=Finalizado AND contabilizado=TRUE AND archived=FALSE del período
    2. Copia a archived_orders (backup histórico)
    3. Marca archived=TRUE en orders
    4. Retorna resumen
    """
    try:
        year, month = map(int, period.split("-"))
        start_date = datetime(year, month, 1)
        if month == 12:
            end_date = datetime(year + 1, 1, 1)
        else:
            end_date = datetime(year, month + 1, 1)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Formato de período inválido. Use YYYY-MM")

    try:
        orders_to_archive = db.query(models.Order).filter(
            models.Order.status == "Finalizado",
            models.Order.contabilizado == True,
            models.Order.archived == False,
            models.Order.created_at >= start_date,
            models.Order.created_at < end_date
        ).all()

        archived_count = 0
        total_archived = 0.0

        for order in orders_to_archive:
            items_json = json.dumps([
                {
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "price": item.price
                }
                for item in order.items
            ])

            archived = models.ArchivedOrder(
                original_id=order.id,
                customer_name=order.customer_name,
                total=order.total,
                status=order.status,
                payment_method=order.payment_method,
                created_at=order.created_at,
                close_period=period,
                total_tax=order.total_tax,
                total_commission=order.total_commission,
                total_real_profit=order.total_real_profit,
                total_cost=order.total_cost,
                is_live_sale=order.is_live_sale,
                items_json=items_json
            )
            db.add(archived)
            order.archived = True
            order.close_period = period
            total_archived += order.total or 0
            archived_count += 1

        db.commit()
        return {
            "success": True,
            "period": period,
            "orders_archived": archived_count,
            "total_amount": total_archived,
            "message": f"✅ {archived_count} órdenes archivadas por ${total_archived:,.0f}"
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# v2.0 - BORRADO MASIVO desde Reportería
# ============================================================

@app.post("/reports/delete-bulk")
def delete_bulk_reports(
    data_type: str = QueryParam(..., description="pedidos | insumos | ingresos"),
    date_from: str = QueryParam(...),
    date_to: str = QueryParam(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Borrado masivo irreversible de registros archivados/contabilizados.
    - pedidos: Solo si archived=TRUE
    - insumos/ingresos: Solo si contabilizado=TRUE
    """
    try:
        date_from_dt = datetime.fromisoformat(date_from)
        date_to_dt = datetime.fromisoformat(date_to) + timedelta(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Use YYYY-MM-DD")

    deleted_count = 0
    try:
        if data_type == "pedidos":
            # Primero eliminar items de las órdenes archivadas
            order_ids = [
                o.id for o in db.query(models.Order.id).filter(
                    models.Order.archived == True,
                    models.Order.created_at >= date_from_dt,
                    models.Order.created_at < date_to_dt
                ).all()
            ]
            if order_ids:
                db.query(models.OrderItem).filter(
                    models.OrderItem.order_id.in_(order_ids)
                ).delete(synchronize_session=False)
            deleted_count = db.query(models.Order).filter(
                models.Order.archived == True,
                models.Order.created_at >= date_from_dt,
                models.Order.created_at < date_to_dt
            ).delete(synchronize_session=False)

        elif data_type == "insumos":
            deleted_count = db.query(models.Insumo).filter(
                models.Insumo.contabilizado == True,
                models.Insumo.date >= date_from_dt,
                models.Insumo.date < date_to_dt
            ).delete(synchronize_session=False)

        elif data_type == "ingresos":
            deleted_count = db.query(models.Ingreso).filter(
                models.Ingreso.contabilizado == True,
                models.Ingreso.date >= date_from_dt,
                models.Ingreso.date < date_to_dt
            ).delete(synchronize_session=False)
        else:
            raise HTTPException(status_code=400, detail="data_type debe ser: pedidos, insumos o ingresos")

        db.commit()
        return {
            "success": True,
            "data_type": data_type,
            "deleted_count": deleted_count,
            "date_range": f"{date_from} a {date_to}"
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
