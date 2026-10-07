import argparse
from sqlalchemy.orm import Session
from database import SessionLocal
import models

def revert_bank_close(close_id: int):
    db: Session = SessionLocal()
    try:
        close = db.query(models.BankClose).filter(models.BankClose.id == close_id).first()
        if not close:
            print(f"Error: No se encontró el cierre bancario con ID {close_id}")
            return
            
        print(f"Revirtiendo Cierre Bancario ID {close_id} ({close.close_type}) del periodo {close.period}...")
        
        # 1. Orders
        orders_query = db.query(models.Order).filter(
            models.Order.status == "Contabilizado",
            models.Order.created_at >= close.date_from,
            models.Order.created_at <= close.date_to
        )
        if close.close_type == "Efectivo":
            orders_query = orders_query.filter(models.Order.payment_method == "Efectivo")
        else:
            orders_query = orders_query.filter(models.Order.payment_method != "Efectivo")
            
        orders_count = orders_query.update({"status": "Pagado", "include_in_close": True})
        
        # 2. Insumos
        insumos_query = db.query(models.Insumo).filter(
            models.Insumo.contabilizado == True,
            models.Insumo.close_period == close.period,
            models.Insumo.date >= close.date_from,
            models.Insumo.date <= close.date_to
        )
        if close.close_type == "Efectivo":
            insumos_query = insumos_query.filter(models.Insumo.payment_type == "Efectivo")
        else:
            insumos_query = insumos_query.filter(models.Insumo.payment_type != "Efectivo")
            
        insumos_count = insumos_query.update({"contabilizado": False, "close_period": None, "include_in_close": True})
        
        # 3. Ingresos
        # Since Ingresos don't have contabilizado or close_period, we just revert include_in_close to True based on date range.
        ingresos_query = db.query(models.Ingreso).filter(
            models.Ingreso.include_in_close == False,
            models.Ingreso.date >= close.date_from,
            models.Ingreso.date <= close.date_to
        )
        if close.close_type == "Efectivo":
            ingresos_query = ingresos_query.filter(models.Ingreso.payment_type == "Efectivo")
        else:
            ingresos_query = ingresos_query.filter(models.Ingreso.payment_type != "Efectivo")
            
        ingresos_count = ingresos_query.update({"include_in_close": True})
        
        # Delete Adjustments and the Close record itself
        adj_count = db.query(models.BankCloseAdjustment).filter(models.BankCloseAdjustment.close_id == close.id).delete()
        db.delete(close)
        
        db.commit()
        
        print("Reversión completada exitosamente:")
        print(f"- Pedidos revertidos a 'Pagado': {orders_count}")
        print(f"- Insumos revertidos a pendientes: {insumos_count}")
        print(f"- Ingresos revertidos a pendientes: {ingresos_count}")
        print(f"- Ajustes eliminados: {adj_count}")
        
    except Exception as e:
        db.rollback()
        print(f"Error al revertir: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Revertir un cierre bancario y restaurar transacciones.")
    parser.add_argument("close_id", type=int, help="ID del cierre bancario a revertir")
    args = parser.parse_args()
    
    confirm = input(f"¿Estás seguro que deseas revertir el cierre {args.close_id}? (s/n): ")
    if confirm.lower() == 's':
        revert_bank_close(args.close_id)
    else:
        print("Operación cancelada.")
