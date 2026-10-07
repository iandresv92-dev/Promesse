import os
import pandas as pd
from sqlalchemy import create_engine, inspect

# Tu URL de base de datos
db_url = "postgresql://postgres.xfofsurejkfaaswiuqog:aivan#24_90@aws-1-us-east-1.pooler.supabase.com:6543/postgres"

def realizar_respaldo():
    try:
        engine = create_engine(db_url)
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        folder = "respaldo_datos"
        if not os.path.exists(folder):
            os.makedirs(folder)

        print(f"Iniciando respaldo de {len(tables)} tablas...")
        
        # Intentar guardar todo en un Excel
        try:
            excel_path = f"{folder}/respaldo_completo.xlsx"
            with pd.ExcelWriter(excel_path) as writer:
                for table in tables:
                    df = pd.read_sql_table(table, engine)
                    df.to_excel(writer, sheet_name=table, index=False)
                    print(f" OK: Tabla '{table}'")
            print(f"\n¡Éxito! Respaldo guardado en: {excel_path}")
        
        except Exception as e:
            print(f"\nNo se pudo crear el Excel (posiblemente falta openpyxl o error: {e}). Guardando como CSVs...")
            for table in tables:
                df = pd.read_sql_table(table, engine)
                df.to_csv(f"{folder}/{table}.csv", index=False)
                print(f" OK: {table}.csv")
            print(f"\n¡Éxito! Archivos guardados en la carpeta: {folder}")

    except Exception as e:
        print(f"\nError crítico: {e}")

if __name__ == "__main__":
    realizar_respaldo()
