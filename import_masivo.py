import requests
import pandas as pd
import math
import getpass
import sys

# === CONFIGURACIÓN ===
# Cambia esta URL a la de tu aplicación en Render si quieres subirlo directamente allá
# Ejemplo: API_URL = "https://tu-app.onrender.com"
API_URL = "https://tu-espacio-deco.onrender.com"
EXCEL_FILE = "ingreso.xlsx"

def main():
    print(f"--- Importador Masivo de Ingresos ---")
    print(f"URL destino: {API_URL}")
    print("Por favor, inicia sesión para continuar.")
    
    username = input("Usuario (admin): ")
    password = getpass.getpass("Contraseña: ")
    
    # 1. Login to get token
    login_url = f"{API_URL}/token"
    try:
        login_res = requests.post(login_url, data={"username": username, "password": password})
    except Exception as e:
        print(f"Error conectando al servidor {API_URL}: {e}")
        return

    if login_res.status_code != 200:
        print("Credenciales incorrectas o error en el login.")
        return
        
    token = login_res.json().get("access_token")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # 2. Read Excel
    print(f"\nLeyendo archivo {EXCEL_FILE}...")
    try:
        df = pd.read_excel(EXCEL_FILE)
    except Exception as e:
        print(f"Error leyendo el archivo Excel: {e}")
        return
        
    # Check if required columns exist
    required_cols = ["PROVEEDOR", "SKU", "NOMBRE", "COSTO", "Precio Final", "cantidad"]
    for col in required_cols:
        if col not in df.columns:
            print(f"Error: No se encontró la columna '{col}' en el archivo Excel.")
            return

    # 3. Process rows
    total_rows = len(df)
    success_count = 0
    error_count = 0

    print(f"Se encontraron {total_rows} filas. Iniciando importación...\n")

    for index, row in df.iterrows():
        # Handle NaN values safely
        proveedor = str(row["PROVEEDOR"]).strip() if pd.notna(row["PROVEEDOR"]) else "Sin Proveedor"
        sku = str(row["SKU"]).strip() if pd.notna(row["SKU"]) else f"GEN-{index}"
        nombre = str(row["NOMBRE"]).strip() if pd.notna(row["NOMBRE"]) else "Producto Sin Nombre"
        
        try:
            costo = float(row["COSTO"]) if pd.notna(row["COSTO"]) else 0.0
            precio_final = float(row["Precio Final"]) if pd.notna(row["Precio Final"]) else 0.0
            cantidad = int(row["cantidad"]) if pd.notna(row["cantidad"]) else 0
        except ValueError:
            print(f"Fila {index+2} ({sku}): Error convirtiendo números. Omitiendo.")
            error_count += 1
            continue

        # Skip rows with 0 quantity if desired, or let them load to just create the product.
        if cantidad < 0:
            cantidad = 0

        # Create payload matching IngresoCreate schema
        payload = {
            "provider": proveedor,
            "sku": sku,
            "name": nombre,
            "cost": costo,
            "suggested_price": precio_final,  # Default suggested to final
            "final_price": precio_final,
            "quantity": cantidad,
            "include_in_close": False
        }

        # Send POST request
        res = requests.post(f"{API_URL}/ingresos", json=payload, headers=headers)
        
        if res.status_code == 200:
            print(f"[{index+1}/{total_rows}] OK: {sku} - {nombre} (+{cantidad})")
            success_count += 1
        else:
            print(f"[{index+1}/{total_rows}] ERROR: {sku} - {res.text}")
            error_count += 1

    print("\n--- Resumen de Importación ---")
    print(f"Exitosos: {success_count}")
    print(f"Errores:  {error_count}")

if __name__ == "__main__":
    main()
