export const MOCK = {
  emissores: [
    { 'CNPJ Emissor': '06.317.144/0001-44', 'Empresa': 'Rodovias do Tietê S.A.', 'Grupo': 'Concessões Viárias', 'Setor': 'Transporte' },
    { 'CNPJ Emissor': '11.renderer.000/0001-01', 'Empresa': 'Energisa Sul-Sudeste', 'Grupo': 'Energisa', 'Setor': 'Energia Elétrica' },
    { 'CNPJ Emissor': '22.333.444/0001-55', 'Empresa': 'Sanepar', 'Grupo': 'Sanepar', 'Setor': 'Saneamento' },
    { 'CNPJ Emissor': '33.444.555/0001-66', 'Empresa': 'Rumo Malha Sul S.A.', 'Grupo': 'Rumo', 'Setor': 'Transporte' },
    { 'CNPJ Emissor': '44.555.666/0001-77', 'Empresa': 'Comgás', 'Grupo': 'Shell', 'Setor': 'Gás' },
    { 'CNPJ Emissor': '55.666.777/0001-88', 'Empresa': 'Iguá Saneamento', 'Grupo': 'Iguá', 'Setor': 'Saneamento' },
    { 'CNPJ Emissor': '66.777.888/0001-99', 'Empresa': 'Pátria Infraestrutura', 'Grupo': 'Pátria', 'Setor': 'Energia Elétrica' },
  ],

  fundos: [
    { 'CNPJ Fundo': '12.345.678/0001-01', 'Nome Fundo': 'KINEA INFRA FI DEBENTURES', 'CNPJ Gestor': '01.111.111/0001-11', 'Nome Gestor': 'KINEA INVESTIMENTOS', 'Patrimônio Líquido (R$)': '8500000000', 'Volume em Debêntures (R$)': '4200000000', 'Gestor Apelido': 'Kinea' },
    { 'CNPJ Fundo': '23.456.789/0001-02', 'Nome Fundo': 'XP INFRA FI DEBENTURES', 'CNPJ Gestor': '02.222.222/0001-22', 'Nome Gestor': 'XP GESTÃO DE RECURSOS', 'Patrimônio Líquido (R$)': '6200000000', 'Volume em Debêntures (R$)': '3100000000', 'Gestor Apelido': 'XP' },
    { 'CNPJ Fundo': '34.567.890/0001-03', 'Nome Fundo': 'ITAÚ INFRA FI DEBENTURES', 'CNPJ Gestor': '03.333.333/0001-33', 'Nome Gestor': 'ITAÚ UNIBANCO', 'Patrimônio Líquido (R$)': '5100000000', 'Volume em Debêntures (R$)': '2800000000', 'Gestor Apelido': 'Itaú' },
    { 'CNPJ Fundo': '45.678.901/0001-04', 'Nome Fundo': 'BTG INFRA FI DEBENTURES', 'CNPJ Gestor': '04.444.444/0001-44', 'Nome Gestor': 'BTG PACTUAL', 'Patrimônio Líquido (R$)': '4800000000', 'Volume em Debêntures (R$)': '2400000000', 'Gestor Apelido': 'BTG' },
    { 'CNPJ Fundo': '56.789.012/0001-05', 'Nome Fundo': 'BRADESCO INFRA FI DEBENTURES', 'CNPJ Gestor': '05.555.555/0001-55', 'Nome Gestor': 'BRADESCO ASSET', 'Patrimônio Líquido (R$)': '3900000000', 'Volume em Debêntures (R$)': '1950000000', 'Gestor Apelido': 'Bradesco' },
  ],

  debentures: [
    { 'Codigo do Ativo': 'RDVT11', 'CNPJ Emissor': '06.317.144/0001-44', 'Quantidade em Mercado': '1000000', 'Valor Nominal Atual': '1124.50', 'Juros Criterio Novo - Taxa': 'IPCA + 6,50%', 'Data de Vencimento': '2032-06-15', 'Data de Emissao': '2022-06-15', 'Indexador': 'IPCA', 'Coordenador Lider': 'BTG Pactual', 'Garantia': 'Real', 'Lei 12.431': 'Sim', 'Descricao': 'Debênture de infraestrutura — concessão de rodovias.' },
    { 'Codigo do Ativo': 'ENGI11', 'CNPJ Emissor': '11.renderer.000/0001-01', 'Quantidade em Mercado': '800000', 'Valor Nominal Atual': '1087.20', 'Juros Criterio Novo - Taxa': 'IPCA + 5,80%', 'Data de Vencimento': '2030-03-20', 'Data de Emissao': '2020-03-20', 'Indexador': 'IPCA', 'Coordenador Lider': 'XP Investimentos', 'Garantia': 'Quirografária', 'Lei 12.431': 'Sim', 'Descricao': 'Debênture do setor elétrico para expansão de rede.' },
    { 'Codigo do Ativo': 'SAPR11', 'CNPJ Emissor': '22.333.444/0001-55', 'Quantidade em Mercado': '600000', 'Valor Nominal Atual': '1210.00', 'Juros Criterio Novo - Taxa': 'IPCA + 7,00%', 'Data de Vencimento': '2033-09-10', 'Data de Emissao': '2023-09-10', 'Indexador': 'IPCA', 'Coordenador Lider': 'Itaú BBA', 'Garantia': 'Real', 'Lei 12.431': 'Sim', 'Descricao': 'Captação para obras de saneamento básico.' },
    { 'Codigo do Ativo': 'RUMOB6', 'CNPJ Emissor': '33.444.555/0001-66', 'Quantidade em Mercado': '500000', 'Valor Nominal Atual': '1345.80', 'Juros Criterio Novo - Taxa': 'CDI + 1,20%', 'Data de Vencimento': '2028-11-30', 'Data de Emissao': '2021-11-30', 'Indexador': 'CDI', 'Coordenador Lider': 'Bradesco BBI', 'Garantia': 'Quirografária', 'Lei 12.431': 'Não', 'Descricao': 'Captação para expansão logística ferroviária.' },
    { 'Codigo do Ativo': 'CGAS14', 'CNPJ Emissor': '44.555.666/0001-77', 'Quantidade em Mercado': '400000', 'Valor Nominal Atual': '1056.30', 'Juros Criterio Novo - Taxa': 'IPCA + 5,20%', 'Data de Vencimento': '2029-05-25', 'Data de Emissao': '2022-05-25', 'Indexador': 'IPCA', 'Coordenador Lider': 'BTG Pactual', 'Garantia': 'Real', 'Lei 12.431': 'Sim', 'Descricao': 'Ampliação de rede de distribuição de gás.' },
    { 'Codigo do Ativo': 'IGUA14', 'CNPJ Emissor': '55.666.777/0001-88', 'Quantidade em Mercado': '300000', 'Valor Nominal Atual': '1189.40', 'Juros Criterio Novo - Taxa': 'IPCA + 7,50%', 'Data de Vencimento': '2034-02-28', 'Data de Emissao': '2024-02-28', 'Indexador': 'IPCA', 'Coordenador Lider': 'Santander', 'Garantia': 'Real', 'Lei 12.431': 'Sim', 'Descricao': 'Projeto de universalização de saneamento.' },
    { 'Codigo do Ativo': 'PATI12', 'CNPJ Emissor': '66.777.888/0001-99', 'Quantidade em Mercado': '700000', 'Valor Nominal Atual': '998.70', 'Juros Criterio Novo - Taxa': 'IPCA + 6,10%', 'Data de Vencimento': '2031-08-15', 'Data de Emissao': '2021-08-15', 'Indexador': 'IPCA', 'Coordenador Lider': 'XP Investimentos', 'Garantia': 'Quirografária', 'Lei 12.431': 'Sim', 'Descricao': 'Fundo de infraestrutura energética.' },
  ],

  blc: [
    // RDVT11
    { 'CD_ATIVO': 'RDVT11', 'CNPJ_FUNDO_CLASSE': '12.345.678/0001-01', 'VL_MERC_POS_FINAL': '450000000' },
    { 'CD_ATIVO': 'RDVT11', 'CNPJ_FUNDO_CLASSE': '23.456.789/0001-02', 'VL_MERC_POS_FINAL': '320000000' },
    { 'CD_ATIVO': 'RDVT11', 'CNPJ_FUNDO_CLASSE': '34.567.890/0001-03', 'VL_MERC_POS_FINAL': '180000000' },
    // ENGI11
    { 'CD_ATIVO': 'ENGI11', 'CNPJ_FUNDO_CLASSE': '12.345.678/0001-01', 'VL_MERC_POS_FINAL': '280000000' },
    { 'CD_ATIVO': 'ENGI11', 'CNPJ_FUNDO_CLASSE': '45.678.901/0001-04', 'VL_MERC_POS_FINAL': '210000000' },
    // SAPR11
    { 'CD_ATIVO': 'SAPR11', 'CNPJ_FUNDO_CLASSE': '23.456.789/0001-02', 'VL_MERC_POS_FINAL': '390000000' },
    { 'CD_ATIVO': 'SAPR11', 'CNPJ_FUNDO_CLASSE': '56.789.012/0001-05', 'VL_MERC_POS_FINAL': '150000000' },
    // RUMOB6
    { 'CD_ATIVO': 'RUMOB6', 'CNPJ_FUNDO_CLASSE': '34.567.890/0001-03', 'VL_MERC_POS_FINAL': '320000000' },
    { 'CD_ATIVO': 'RUMOB6', 'CNPJ_FUNDO_CLASSE': '45.678.901/0001-04', 'VL_MERC_POS_FINAL': '190000000' },
    // CGAS14
    { 'CD_ATIVO': 'CGAS14', 'CNPJ_FUNDO_CLASSE': '12.345.678/0001-01', 'VL_MERC_POS_FINAL': '210000000' },
    // IGUA14
    { 'CD_ATIVO': 'IGUA14', 'CNPJ_FUNDO_CLASSE': '56.789.012/0001-05', 'VL_MERC_POS_FINAL': '280000000' },
    { 'CD_ATIVO': 'IGUA14', 'CNPJ_FUNDO_CLASSE': '23.456.789/0001-02', 'VL_MERC_POS_FINAL': '120000000' },
    // PATI12
    { 'CD_ATIVO': 'PATI12', 'CNPJ_FUNDO_CLASSE': '34.567.890/0001-03', 'VL_MERC_POS_FINAL': '350000000' },
    { 'CD_ATIVO': 'PATI12', 'CNPJ_FUNDO_CLASSE': '12.345.678/0001-01', 'VL_MERC_POS_FINAL': '175000000' },
  ],
}
