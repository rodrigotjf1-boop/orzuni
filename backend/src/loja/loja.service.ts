import { Injectable } from '@nestjs/common';
import { IfoodMerchantService } from '../ifood/ifood-merchant.service';

/**
 * Módulo Loja (Merchant) — modelo canônico do Orzuni sobre a Merchant API do iFood.
 * Cobre os critérios de homologação do módulo Merchant: detalhe, status, interrupções
 * (pausa) e horário de funcionamento. Traduz os erros do iFood (409 overlap / recently
 * created, 400 turnos sobrepostos) em mensagens claras; o código cru vai para a telemetria.
 */
@Injectable()
export class LojaService {
  constructor(private readonly ifood: IfoodMerchantService) {}

  // extrai code/message do corpo de erro do iFood
  private erroIfood(data: any): { codigo?: string; mensagem: string } {
    const e = data?.error ?? data;
    const codigo = e?.code;
    const mensagem = e?.message || (codigo ? `erro ${codigo}` : 'não foi possível concluir a operação');
    return { codigo, mensagem };
  }

  /** Lojas autorizadas ao app (com paginação opcional). */
  async lojas(page?: number, size?: number) {
    const m = await this.ifood.merchants(page, size);
    return m.map((x) => ({ id: x.id, nome: x.name, razaoSocial: (x as any).corporateName ?? x.name }));
  }

  /** Painel da loja: detalhe + status operacional normalizados. */
  async painel(merchantId: string) {
    const [d, statusArr] = await Promise.all([this.ifood.detalhe(merchantId), this.ifood.status(merchantId)]);
    const detalhe = d
      ? {
          id: d.id,
          nome: d.name,
          razaoSocial: d.corporateName,
          tipo: d.type,
          statusCadastral: d.status, // ex.: DISABLED/ENABLED (cadastro)
          endereco: d.address
            ? {
                rua: d.address.street,
                numero: d.address.number,
                bairro: d.address.district,
                cidade: d.address.city,
                uf: d.address.state,
                cep: d.address.postalCode,
              }
            : null,
          operacoes: (d.operations ?? []).map((o: any) => o.name),
        }
      : null;

    // status: pega o primeiro canal/operação (ex.: ifood-app/delivery)
    const s = statusArr[0];
    const status = s
      ? {
          aberta: !!s.available,
          estado: s.state, // OK | WARNING | CLOSED | ERROR
          titulo: s.message?.title ?? '',
          canal: s.salesChannel,
          operacao: s.operation,
          validacoes: (s.validations ?? []).map((v: any) => ({
            id: v.id,
            estado: v.state,
            titulo: v.message?.title ?? '',
            subtitulo: v.message?.subtitle ?? '',
          })),
        }
      : null;

    return { detalhe, status };
  }

  /** Interrupções (pausas) atuais. */
  async interrupcoes(merchantId: string) {
    const arr = await this.ifood.interrupcoes(merchantId);
    return arr.map((i: any) => ({ id: i.id, descricao: i.description ?? '', inicio: i.start, fim: i.end }));
  }

  /** Cria uma pausa (interrupção). `inicio`/`fim` em ISO 8601. */
  async criarInterrupcao(merchantId: string, dados: { descricao: string; inicio: string; fim: string }): Promise<{ ok: boolean; id?: string; erro?: string; codigo?: string }> {
    if (!dados.inicio || !dados.fim) return { ok: false, erro: 'informe início e fim da pausa' };
    if (new Date(dados.fim) <= new Date(dados.inicio)) return { ok: false, erro: 'o fim deve ser depois do início' };
    const r = await this.ifood.criarInterrupcao(merchantId, { description: dados.descricao?.trim() || 'Pausa', start: dados.inicio, end: dados.fim });
    if (r.status === 201) return { ok: true, id: r.data?.id };
    const e = this.erroIfood(r.data);
    // mensagens amigáveis para os códigos que a homologação testa
    const amigavel =
      e.codigo === 'InterruptionOverlap' ? 'Já existe uma pausa que se sobrepõe a esse período.' : e.mensagem;
    return { ok: false, erro: amigavel, codigo: e.codigo };
  }

  /** Cancela uma pausa. iFood recusa (409) logo após criar (RecentlyCreatedInterruption). */
  async cancelarInterrupcao(merchantId: string, id: string): Promise<{ ok: boolean; erro?: string; codigo?: string }> {
    const r = await this.ifood.removerInterrupcao(merchantId, id);
    if (r.status >= 200 && r.status < 300) return { ok: true };
    const e = this.erroIfood(r.data);
    const amigavel =
      e.codigo === 'RecentlyCreatedInterruption' ? 'A pausa foi criada há pouco — aguarde alguns instantes para cancelar.' : e.mensagem;
    return { ok: false, erro: amigavel, codigo: e.codigo };
  }

  /** Horário de funcionamento (turnos por dia). */
  async horarios(merchantId: string) {
    const oh = await this.ifood.openingHours(merchantId);
    const shifts = (oh?.shifts ?? []).map((s: any) => ({ id: s.id, dia: s.dayOfWeek, inicio: s.start, duracao: s.duration }));
    return { shifts };
  }

  /** Salva o horário (PUT substitui todos os turnos). Trata 400 (turnos sobrepostos). */
  async salvarHorarios(merchantId: string, shifts: Array<{ dia: string; inicio: string; duracao: number }>): Promise<{ ok: boolean; erro?: string; codigo?: string }> {
    const payload = shifts.map((s) => ({ dayOfWeek: s.dia, start: s.inicio.length === 5 ? `${s.inicio}:00` : s.inicio, duration: Math.round(s.duracao) }));
    const r = await this.ifood.salvarOpeningHours(merchantId, payload);
    if (r.status === 201 || (r.status >= 200 && r.status < 300)) return { ok: true };
    const e = this.erroIfood(r.data);
    // 400 (InvalidOpeningHours / bad request) = turnos sobrepostos ou inválidos no mesmo dia
    const amigavel =
      e.codigo === 'InvalidOpeningHours' || r.status === 400
        ? 'Turnos sobrepostos ou inválidos: no mesmo dia, um turno não pode cruzar com outro. Ajuste os horários.'
        : e.mensagem;
    return { ok: false, erro: amigavel, codigo: e.codigo || (r.status === 400 ? 'InvalidOpeningHours' : undefined) };
  }
}
