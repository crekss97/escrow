# Sistema de Escrow para Compra/Venta

TP integrador de contratos inteligentes con dos contratos que interactuan entre si en Sepolia.

## Idea

El vendedor publica productos en `Marketplace`. El comprador elige una publicacion desde la app y compra depositando el precio exacto en `EscrowVault`. El ETH queda custodiado hasta que el comprador confirma la recepcion. En ese momento `EscrowVault` libera el pago al vendedor.

## Contratos

| Contrato | Responsabilidad |
|----------|-----------------|
| `Marketplace` | Publica productos, administra estado de publicaciones, permite baja logica y registra compras. |
| `EscrowVault` | Recibe ETH, crea compras fondeadas en `Marketplace`, libera pagos y reembolsa compras activas. |

Interaccion cross-contract verificable:

- `EscrowVault.buyProduct()` llama a `Marketplace.getProduct()` y `Marketplace.createFundedPurchase()`.
- `EscrowVault.confirmReceipt()` llama a `Marketplace.getPurchase()`, `Marketplace.isPurchaseActive()` y `Marketplace.markCompleted()`.
- `EscrowVault.refundBuyer()` llama a `Marketplace.markCancelled()`.

## Seguridad

- Funciones con ETH protegidas con `nonReentrant`.
- Patron CEI: validaciones, cambios de estado y despues transferencia externa.
- Deposito exacto del precio publicado.
- El vendedor no puede comprar su propio producto.
- Solo el comprador puede confirmar recepcion o pedir reembolso.
- Solo el vault autorizado puede crear compras y cambiar estados de compras.
- NatSpec agregado en funciones `public` y `external`.

## Frontend

La app tiene dos vistas:

- `Vista comprador`: lista publicaciones, compra con escrow, consulta compras, confirma recepcion y solicita reembolso.
- `Vista vendedor`: publica productos, pausa/reactiva publicaciones y cambia de perfil sin salir de la app.
- `Actividad y logs`: separa transacciones, logs y links a Etherscan del flujo principal.

Tambien incluye:

- Modal de confirmacion antes de cada transaccion.
- Links directos a Sepolia Etherscan para contratos, cuenta y transacciones.
- Filtros de publicaciones: disponibles, publicadas por mi, ya compradas, pausadas, eliminadas y todas.
- Conexion de wallet restaurada temporalmente con `localStorage` durante 30 minutos si MetaMask ya autorizo la app.
- Metadatos SEO en `index.html`.

## Requisitos

- Node.js 20 o superior.
- MetaMask con Sepolia configurada.
- ETH de prueba en Sepolia.
- Cuenta de RPC: Infura, Alchemy o similar.
- API key de Etherscan para verificar contratos.

Extensiones recomendadas para VS Code:

- Solidity, de Juan Blanco.
- Hardhat for Visual Studio Code, de Nomic Foundation.
- ESLint, opcional para JavaScript.
- DotENV, opcional para archivos `.env`.

## Instalacion

```bash
npm install
```

Completar `.env`:

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/TU_API_KEY
PRIVATE_KEY=tu_private_key
ETHERSCAN_API_KEY=tu_api_key_de_etherscan
```

## Tests

```bash
npm test
```

La tabla pedida por la consigna esta en `TEST_CASES.md`.

## Deploy en Sepolia

```bash
npm run deploy:sepolia
```

El script guarda direcciones en:

- `deployments.json`
- `frontend/src/deployments.json`

## Verificacion en Etherscan

```bash
npm run verify:sepolia
```

Si Etherscan tarda en indexar, esperar unos minutos y repetir el comando.

## Ejecutar frontend

```bash
npm run frontend
```

Abrir `http://127.0.0.1:5173`.

Flujo demo sugerido:

1. Conectar MetaMask en Sepolia.
2. Usar `Vista vendedor` con Account 1 y publicar producto por `0.001` o `0.002 ETH`.
3. Cambiar MetaMask a Account 2.
4. Usar `Vista comprador` y comprar el producto.
5. Confirmar en el modal de la app y despues en MetaMask.
6. Consultar la compra y confirmar recepcion.
7. Abrir links de Etherscan desde el panel de evidencia.

## Evidencia para presentar

- Direcciones de ambos contratos en Sepolia.
- Links de Etherscan verificados.
- Transaccion de `setVault`.
- Transaccion de `buyProduct`, donde se ve la llamada cross-contract a `Marketplace.createFundedPurchase`.
- Transaccion de `confirmReceipt`, donde se ve la llamada cross-contract a `Marketplace.markCompleted` y la transferencia al vendedor.
- Transaccion opcional de `deleteProduct`, que marca una publicacion como eliminada sin borrar el historial inmutable.
- Captura de `npm test` y tabla `TEST_CASES.md`.
