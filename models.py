from sqlalchemy import Column, ForeignKey, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import relationship
import datetime
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    sku = Column(String, unique=True, index=True, nullable=True)
    barcode = Column(String, unique=True, index=True, nullable=True)
    name = Column(String, index=True)
    price = Column(Float)
    cost = Column(Float, default=0.0)
    stock = Column(Integer, default=0)
    provider = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    deleted = Column(Boolean, default=False)

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    customer_name = Column(String, index=True, nullable=True)
    total = Column(Float, default=0.0)
    status = Column(String, default="Recibido") # Recibido, En Preparación, Preparado, Despachado, Pagado, Por Pagar, Finalizado, Cancelado
    payment_method = Column(String, default="Efectivo") # "Efectivo", "Transferencia", "Tarjeta", etc.
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    total_tax = Column(Float, default=0.0)
    total_commission = Column(Float, default=0.0)
    total_real_profit = Column(Float, default=0.0)
    total_cost = Column(Float, default=0.0)
    include_in_close = Column(Boolean, default=False)
    is_live_sale = Column(Boolean, default=False)
    deleted = Column(Boolean, default=False)
    close_period = Column(String, nullable=True)

    # v2.0 CAMPOS NUEVOS
    contabilizado = Column(Boolean, default=False)  # Solo TRUE cuando status=Finalizado
    archived = Column(Boolean, default=False)       # TRUE después de cierre período

    items = relationship("OrderItem", back_populates="order")

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer)
    price = Column(Float)
    
    cost_unit = Column(Float, default=0.0)
    tax = Column(Float, default=0.0)
    commission = Column(Float, default=0.0)
    real_profit = Column(Float, default=0.0)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")

class BankClose(Base):
    __tablename__ = "bank_closes"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    close_type = Column(String, default="Efectivo") # "Efectivo", "Tarjeta/Transferencia"
    saldo_inicial = Column(Float, default=0.0)
    saldo_esperado = Column(Float, default=0.0)
    saldo_real = Column(Float, nullable=True)
    diferencia = Column(Float, nullable=True)
    notas = Column(String, nullable=True)
    period = Column(String, nullable=True)
    date_from = Column(DateTime, nullable=True)
    date_to = Column(DateTime, nullable=True)
    
    adjustments = relationship("BankCloseAdjustment", back_populates="close")

class BankCloseAdjustment(Base):
    __tablename__ = "bank_close_adjustments"
    id = Column(Integer, primary_key=True, index=True)
    close_id = Column(Integer, ForeignKey("bank_closes.id"))
    tipo = Column(String) # "ingreso" o "egreso"
    monto = Column(Float)
    comentario = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    close = relationship("BankClose", back_populates="adjustments")

class Insumo(Base):
    __tablename__ = "insumos"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, default=datetime.datetime.utcnow)
    item = Column(String, index=True)
    sku = Column(String, index=True, nullable=True)
    cost = Column(Float)
    include_in_close = Column(Boolean, default=False)
    payment_type = Column(String, default="Efectivo")
    contabilizado = Column(Boolean, default=False)
    close_period = Column(String, nullable=True)

class Migration(Base):
    __tablename__ = "migrations"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    applied_at = Column(DateTime, default=datetime.datetime.utcnow)

class VatPayment(Base):
    __tablename__ = "vat_payments"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, default=datetime.datetime.utcnow)
    amount = Column(Float)

class Ingreso(Base):
    __tablename__ = "ingresos"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, default=datetime.datetime.utcnow)
    provider = Column(String, index=True)
    sku = Column(String, index=True)
    name = Column(String)
    cost = Column(Float)
    suggested_price = Column(Float)
    final_price = Column(Float)
    quantity = Column(Integer)
    include_in_close = Column(Boolean, default=False)
    payment_type = Column(String, default="Efectivo")
    contabilizado = Column(Boolean, default=False)
    close_period = Column(String, nullable=True)

class ArchivedOrder(Base):
    """Histórico de órdenes finalizadas y archivadas post-cierre de período"""
    __tablename__ = "archived_orders"

    id = Column(Integer, primary_key=True, index=True)
    original_id = Column(Integer, nullable=False)
    customer_name = Column(String, nullable=True)
    total = Column(Float, default=0.0)
    status = Column(String)
    payment_method = Column(String, nullable=True)
    created_at = Column(DateTime)
    archived_at = Column(DateTime, default=datetime.datetime.utcnow)
    close_period = Column(String, nullable=True)

    total_tax = Column(Float, default=0.0)
    total_commission = Column(Float, default=0.0)
    total_real_profit = Column(Float, default=0.0)
    total_cost = Column(Float, default=0.0)
    is_live_sale = Column(Boolean, default=False)
    items_json = Column(String, nullable=True)  # JSON string de items
    notes = Column(String, nullable=True)
