/**
 * O cliente do Hub DMS no Orzuni (`ClienteHub` do pacote comum, Padrão §10), um
 * por processo.
 *
 * - **Registro central:** cada chamada da porta MCP (quem chamou, a ferramenta,
 *   o resultado e a duração; NUNCA o conteúdo) vai ao hub em lote. Quem anota é
 *   o middleware da porta (`RegistroDaPorta`).
 * - **Erros:** o erro inesperado (5xx) da porta vai à lista de erros do hub, já
 *   sem dado da loja (o pacote limpa a mensagem).
 * - **Lista de parada:** lida de tempos em tempos; o portão da porta recusa a
 *   chamada parada (503 `integracao-parada`). Se o hub cair, vale a última lida.
 * - **Batida:** com a versão no ar e a chave própria "aceitar integrações".
 *
 * Nasce DESLIGADO (`HUB_LIGADO`): sem ele, nada sai daqui e nada é parado pelo
 * hub. A chave própria (`ACEITAR_INTEGRACOES`) vale com ou sem o hub, e o portão
 * já a aplica. Nada aqui espera o hub nem falha a chamada de quem usa a porta: o
 * hub fora do ar só vira aviso no log.
 */
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';

import {
  ClienteDmsId,
  ClienteHub,
  type ChamadaAtendida,
  type ChamadaRegistrada,
  type ErroDoProduto,
  type ItemDeParada,
} from '../dms/integracao-dms';
import { hub } from './config';

/** O mesmo motivo de falha só volta ao log depois deste tempo: o hub fora não pode afogar o log. */
const SILENCIO_DO_MESMO_AVISO_MS = 5 * 60_000;

@Injectable()
export class HubService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Hub');
  private cliente: ClienteHub | null = null;
  private ultimoAviso: { motivo: string; em: number } | null = null;

  /** Mandando ao hub e lendo a lista de parada (`HUB_LIGADO`). */
  get ligado(): boolean {
    return this.cliente !== null;
  }

  /** A chave própria do Padrão (§10): falsa = a porta recusa toda chamada de integração, com ou sem o hub. */
  get aceitaIntegracoes(): boolean {
    return hub.aceitaIntegracoes;
  }

  onModuleInit(): void {
    if (!hub.ligado) return;
    this.cliente = new ClienteHub({
      url: hub.url,
      recurso: hub.recurso,
      dmsId: new ClienteDmsId({ emissor: hub.emissor, aplicativo: hub.aplicativo, segredo: hub.segredo }),
      produto: 'orzuni',
      versao: hub.versao,
      aceitaIntegracoes: () => this.aceitaIntegracoes,
      aoFalhar: (motivo) => this.avisar(motivo),
    });
    this.cliente.iniciar();
    this.log.log(`Hub ligado (${hub.url}): registro da porta MCP, erros e lista de parada.`);
  }

  /** No desligamento: para os relógios e manda o que falta, uma vez. */
  async onApplicationShutdown(): Promise<void> {
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) await cliente.parar();
  }

  /** A parada que vale para esta chamada, pela última lista lida (nula: pode atender). Desligado: nunca para. */
  parado(chamada: ChamadaAtendida): ItemDeParada | null {
    return this.cliente ? this.cliente.parado(chamada) : null;
  }

  /** Anota uma chamada da porta para o registro central. Desligado: nada. */
  registrar(chamada: ChamadaRegistrada): void {
    if (this.cliente) this.cliente.registrar(chamada);
  }

  /** Anota um erro para a lista de erros do hub (o pacote limpa a mensagem). Desligado: nada. */
  erro(erro: ErroDoProduto): void {
    if (this.cliente) this.cliente.erro(erro);
  }

  /** Falha de envio ou de leitura (hub fora, rede, recusa): aviso no log, sem repetir o mesmo motivo a cada volta. */
  private avisar(motivo: string): void {
    const agora = Date.now();
    if (this.ultimoAviso && this.ultimoAviso.motivo === motivo && agora - this.ultimoAviso.em < SILENCIO_DO_MESMO_AVISO_MS) return;
    this.ultimoAviso = { motivo, em: agora };
    this.log.warn(`Hub: ${motivo}`);
  }
}
