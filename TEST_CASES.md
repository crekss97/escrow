# Tabla de Casos Probados

| # | Caso | Inputs | Output esperado | Output obtenido |
|---|------|--------|-----------------|-----------------|
| 1 | Publicar producto valido | seller, titulo `Notebook`, precio `0.02 ETH`, descripcion | Evento `ProductPublished`, producto activo | Validado por test |
| 2 | Publicar producto con precio cero | precio `0` | Revert `InvalidPrice` | Validado por test |
| 3 | Pausar y reactivar publicacion | seller, producto `#1`, active `false/true` | Evento `ProductStatusChanged`, estado actualizado | Validado por test |
| 4 | Cambiar publicacion desde tercero | stranger intenta pausar producto del seller | Revert `NotSeller` | Validado por test |
| 5 | Eliminar publicacion | seller elimina producto `#1` | Evento `ProductDeleted`, producto inactive/deleted | Validado por test |
| 6 | Comprar producto eliminado | buyer compra producto deleted | Revert `ProductUnavailable` | Validado por test |
| 7 | Comprar producto con escrow | buyer compra producto `#1` con `0.02 ETH` | Eventos `PurchaseFunded` y `PurchaseCreated`, compra `Funded` | Validado por test |
| 8 | Comprar con monto incorrecto | buyer envia `0.01 ETH` | Revert `InvalidAmount` | Validado por test |
| 9 | Vendedor compra su propio producto | seller compra producto propio | Revert `ProductUnavailable` | Validado por test |
| 10 | Comprar producto pausado | buyer compra producto inactive | Revert `ProductUnavailable` | Validado por test |
| 11 | Confirmar recepcion | buyer confirma compra `Funded` | ETH liberado al seller, estado `Completed` | Validado por test |
| 12 | Confirmar desde tercero | stranger confirma compra del buyer | Revert `OnlyBuyer` | Validado por test |
| 13 | Cancelar compra y reembolsar | buyer cancela compra `Funded` | ETH vuelve al buyer, estado `Cancelled` | Validado por test |

Comando usado:

```bash
npm test
```
