from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class ProductBase(BaseModel):
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name: str
    price: float
    cost: float = 0.0
    stock: int = 0
    provider: Optional[str] = None
    image_url: Optional[str] = None

class ProductCreate(ProductBase):
    pass

class Product(ProductBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True

class OrderItemBase(BaseModel):
    product_id: int
    quantity: int
    price: float
    cost_unit: float = 0.0
    tax: float = 0.0
    commission: float = 0.0
    real_profit: float = 0.0

class OrderItemCreate(OrderItemBase):
    pass

class OrderItem(OrderItemBase):
    id: int
    product: Optional[Product] = None
    class Config:
        from_attributes = True

class OrderBase(BaseModel):
    customer_name: Optional[str] = None
    status: str = "Recibido" # Recibido, En Preparación, Preparado, Despachado, Pagado, Por Pagar, Finalizado, Cancelado
    payment_method: str = "Efectivo"
    created_at: Optional[datetime] = None
    include_in_close: bool = False
    is_live_sale: bool = False

class OrderCreate(OrderBase):
    items: List[OrderItemCreate]

class Order(OrderBase):
    id: int
    total: float
    total_tax: float = 0.0
    total_commission: float = 0.0
    total_real_profit: float = 0.0
    total_cost: float = 0.0
    items: List[OrderItem] = []
    class Config:
        from_attributes = True

class BankCloseBase(BaseModel):
    close_type: str = "Efectivo"
    saldo_inicial: float = 0.0
    saldo_esperado: float = 0.0
    saldo_real: Optional[float] = None
    diferencia: Optional[float] = None
    notas: Optional[str] = None
    period: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None

class BankCloseAdjustmentBase(BaseModel):
    tipo: str
    monto: float
    comentario: str

class BankCloseAdjustmentCreate(BankCloseAdjustmentBase):
    pass

class BankCloseAdjustment(BankCloseAdjustmentBase):
    id: int
    close_id: int
    created_at: datetime
    class Config:
        from_attributes = True

class BankCloseCreate(BankCloseBase):
    adjustments: List[BankCloseAdjustmentCreate] = []

class BankClose(BankCloseBase):
    id: int
    created_at: datetime
    adjustments: List[BankCloseAdjustment] = []
    class Config:
        from_attributes = True

class InsumoBase(BaseModel):
    item: str
    sku: Optional[str] = None
    cost: float
    date: Optional[datetime] = None
    include_in_close: bool = False
    payment_type: str = "Efectivo"
    contabilizado: bool = False
    close_period: Optional[str] = None

class InsumoCreate(InsumoBase):
    pass

class Insumo(InsumoBase):
    id: int
    date: datetime
    class Config:
        from_attributes = True

class VatPaymentBase(BaseModel):
    amount: float

class VatPaymentCreate(VatPaymentBase):
    pass

class VatPayment(VatPaymentBase):
    id: int
    date: datetime
    class Config:
        from_attributes = True

class IngresoBase(BaseModel):
    provider: str
    sku: str
    name: str
    cost: float
    suggested_price: float
    final_price: float
    quantity: int
    include_in_close: bool = False
    payment_type: str = "Efectivo"
    contabilizado: bool = False
    close_period: Optional[str] = None

class IngresoCreate(IngresoBase):
    image_url: Optional[str] = None

class Ingreso(IngresoBase):
    id: int
    date: datetime
    image_url: Optional[str] = None
    class Config:
        from_attributes = True

class PaginatedProducts(BaseModel):
    items: List[Product]
    total: int
    page: int
    limit: int
    total_pages: int

class PaginatedIngresos(BaseModel):
    items: List[Ingreso]
    total: int
    page: int
    limit: int
    total_pages: int

class PaginatedOrders(BaseModel):
    items: List[Order]
    total: int
    page: int
    limit: int
    total_pages: int

class Token(BaseModel):
    access_token: str
    token_type: str
